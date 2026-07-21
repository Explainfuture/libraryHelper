// Package transfer owns the in-memory lifecycle of temporary EPUB transfers.
// Raw access tokens are returned once at creation and are never stored.
package transfer

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sync"
	"time"
)

const (
	TokenBytes             = 32
	DefaultTTL             = 5 * time.Minute
	DefaultCleanupInterval = time.Minute
	maximumRandomAttempts  = 8
)

var (
	ErrInvalidInput     = errors.New("invalid transfer input")
	ErrSessionNotFound  = errors.New("transfer session not found")
	ErrSessionNotActive = errors.New("transfer session is not active")
	ErrStoreClosed      = errors.New("transfer store is closed")
	ErrRandomCollision  = errors.New("could not allocate a unique transfer identity")
)

type Status string

const (
	StatusActive       Status = "active"
	StatusTransferring Status = "transferring"
	StatusCancelled    Status = "cancelled"
	StatusCompleted    Status = "completed"
)

// Session contains only the token hash. The raw token is kept by the caller
// and placed in the temporary URL.
type Session struct {
	TransferID string
	TokenHash  [sha256.Size]byte
	FilePath   string
	Filename   string
	Size       int64
	CreatedAt  time.Time
	ExpiresAt  time.Time
	Status     Status
}

type CreateInput struct {
	FilePath string
	Filename string
	Size     int64
}

// Options provides deterministic seams for tests. A negative cleanup interval
// disables the background loop; zero selects DefaultCleanupInterval.
type Options struct {
	TTL             time.Duration
	CleanupInterval time.Duration
	Clock           func() time.Time
	RandomReader    io.Reader
}

// Store is a concurrency-safe in-memory session repository.
type Store struct {
	mu       sync.RWMutex
	randomMu sync.Mutex
	sessions map[string]Session
	ttl      time.Duration
	clock    func() time.Time
	random   io.Reader
	closed   bool

	stop      chan struct{}
	stopped   chan struct{}
	closeOnce sync.Once
}

func NewStore(options Options) *Store {
	ttl := options.TTL
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	clock := options.Clock
	if clock == nil {
		clock = time.Now
	}
	randomReader := options.RandomReader
	if randomReader == nil {
		randomReader = rand.Reader
	}

	store := &Store{
		sessions: make(map[string]Session),
		ttl:      ttl,
		clock:    clock,
		random:   randomReader,
		stop:     make(chan struct{}),
		stopped:  make(chan struct{}),
	}

	cleanupInterval := options.CleanupInterval
	if cleanupInterval == 0 {
		cleanupInterval = DefaultCleanupInterval
	}
	if cleanupInterval < 0 {
		close(store.stopped)
	} else {
		go store.cleanupLoop(cleanupInterval)
	}

	return store
}

// Create allocates a UUID and at least 256 bits of random token entropy.
func (store *Store) Create(input CreateInput) (Session, string, error) {
	if !filepath.IsAbs(input.FilePath) || input.Filename == "" || input.Size <= 0 {
		return Session{}, "", ErrInvalidInput
	}
	store.mu.RLock()
	closed := store.closed
	store.mu.RUnlock()
	if closed {
		return Session{}, "", ErrStoreClosed
	}

	for range maximumRandomAttempts {
		transferID, token, tokenHash, err := store.generateIdentity()
		if err != nil {
			return Session{}, "", err
		}

		store.mu.Lock()
		if store.closed {
			store.mu.Unlock()
			return Session{}, "", ErrStoreClosed
		}
		if _, exists := store.sessions[transferID]; exists || store.hasTokenHashLocked(tokenHash) {
			store.mu.Unlock()
			continue
		}

		createdAt := store.clock().UTC()
		session := Session{
			TransferID: transferID,
			TokenHash:  tokenHash,
			FilePath:   input.FilePath,
			Filename:   input.Filename,
			Size:       input.Size,
			CreatedAt:  createdAt,
			ExpiresAt:  createdAt.Add(store.ttl),
			Status:     StatusActive,
		}
		store.sessions[transferID] = session
		store.mu.Unlock()
		return session, token, nil
	}

	return Session{}, "", ErrRandomCollision
}

// Resolve returns active or completed sessions for a raw token. Cancelled and
// expired sessions are deliberately indistinguishable from unknown tokens.
func (store *Store) Resolve(token string) (Session, bool) {
	candidateHash := hashToken(token)
	now := store.clock().UTC()

	store.mu.RLock()
	defer store.mu.RUnlock()
	if store.closed {
		return Session{}, false
	}

	var result Session
	found := false
	for _, session := range store.sessions {
		matches := tokenHashesEqual(candidateHash, session.TokenHash)
		accessible := session.Status != StatusCancelled && now.Before(session.ExpiresAt)
		if matches && accessible {
			result = session
			found = true
		}
	}
	return result, found
}

func (store *Store) Get(transferID string) (Session, bool) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	session, found := store.sessions[transferID]
	return session, found && !store.closed
}

func (store *Store) Cancel(transferID string) (Session, error) {
	now := store.clock().UTC()

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return Session{}, ErrStoreClosed
	}
	session, found := store.sessions[transferID]
	if !found {
		return Session{}, ErrSessionNotFound
	}
	if session.Status != StatusActive && session.Status != StatusTransferring {
		return Session{}, ErrSessionNotActive
	}
	if session.Status == StatusActive && !now.Before(session.ExpiresAt) {
		return Session{}, ErrSessionNotActive
	}
	session.Status = StatusCancelled
	store.sessions[transferID] = session
	return session, nil
}

func (store *Store) Complete(transferID string) (Session, error) {
	now := store.clock().UTC()

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return Session{}, ErrStoreClosed
	}
	session, found := store.sessions[transferID]
	if !found {
		return Session{}, ErrSessionNotFound
	}
	if session.Status != StatusTransferring && (session.Status != StatusActive || !now.Before(session.ExpiresAt)) {
		return Session{}, ErrSessionNotActive
	}
	session.Status = StatusCompleted
	store.sessions[transferID] = session
	return session, nil
}

// BeginDownload atomically claims an active session for one GET request.
func (store *Store) BeginDownload(transferID string) (Session, error) {
	now := store.clock().UTC()

	store.mu.Lock()
	defer store.mu.Unlock()
	session, err := store.activeSessionLocked(transferID, now)
	if err != nil {
		return Session{}, err
	}
	if session.Status != StatusActive {
		return Session{}, ErrSessionNotActive
	}
	session.Status = StatusTransferring
	store.sessions[transferID] = session
	return session, nil
}

// AbortDownload makes an interrupted transfer available again until expiry.
func (store *Store) AbortDownload(transferID string) (Session, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return Session{}, ErrStoreClosed
	}
	session, found := store.sessions[transferID]
	if !found {
		return Session{}, ErrSessionNotFound
	}
	if session.Status != StatusTransferring {
		return Session{}, ErrSessionNotActive
	}
	session.Status = StatusActive
	store.sessions[transferID] = session
	return session, nil
}

func (store *Store) activeSessionLocked(transferID string, now time.Time) (Session, error) {
	if store.closed {
		return Session{}, ErrStoreClosed
	}
	session, found := store.sessions[transferID]
	if !found {
		return Session{}, ErrSessionNotFound
	}
	if !now.Before(session.ExpiresAt) {
		return Session{}, ErrSessionNotActive
	}
	return session, nil
}

// CleanupExpired removes sessions whose expiry is at or before the current
// clock value and returns the number removed.
func (store *Store) CleanupExpired() int {
	now := store.clock().UTC()
	removed := 0

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed {
		return 0
	}
	for transferID, session := range store.sessions {
		if session.Status != StatusTransferring && !now.Before(session.ExpiresAt) {
			delete(store.sessions, transferID)
			removed++
		}
	}
	return removed
}

func (store *Store) Count() int {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return len(store.sessions)
}

// Close stops background cleanup and releases all in-memory session data.
func (store *Store) Close() error {
	store.closeOnce.Do(func() {
		store.mu.Lock()
		store.closed = true
		clear(store.sessions)
		store.mu.Unlock()

		close(store.stop)
		<-store.stopped
	})
	return nil
}

func (store *Store) cleanupLoop(interval time.Duration) {
	defer close(store.stopped)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			store.CleanupExpired()
		case <-store.stop:
			return
		}
	}
}

func (store *Store) generateIdentity() (string, string, [sha256.Size]byte, error) {
	store.randomMu.Lock()
	defer store.randomMu.Unlock()

	transferID, err := generateUUID(store.random)
	if err != nil {
		return "", "", [sha256.Size]byte{}, fmt.Errorf("generate transfer ID: %w", err)
	}
	token, tokenHash, err := generateToken(store.random)
	if err != nil {
		return "", "", [sha256.Size]byte{}, fmt.Errorf("generate transfer token: %w", err)
	}
	return transferID, token, tokenHash, nil
}

func (store *Store) hasTokenHashLocked(candidate [sha256.Size]byte) bool {
	for _, session := range store.sessions {
		if tokenHashesEqual(candidate, session.TokenHash) {
			return true
		}
	}
	return false
}

func generateToken(reader io.Reader) (string, [sha256.Size]byte, error) {
	bytes := make([]byte, TokenBytes)
	if _, err := io.ReadFull(reader, bytes); err != nil {
		return "", [sha256.Size]byte{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(bytes)
	return token, hashToken(token), nil
}

func hashToken(token string) [sha256.Size]byte {
	return sha256.Sum256([]byte(token))
}

func tokenHashesEqual(left, right [sha256.Size]byte) bool {
	return subtle.ConstantTimeCompare(left[:], right[:]) == 1
}

func generateUUID(reader io.Reader) (string, error) {
	var bytes [16]byte
	if _, err := io.ReadFull(reader, bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16]), nil
}
