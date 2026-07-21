package transfer

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"path/filepath"
	"regexp"
	"sync"
	"testing"
	"time"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestStoreCreatesSessionWithHashedToken(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 21, 10, 0, 0, 0, time.FixedZone("test", 8*60*60))
	store := NewStore(Options{
		Clock:           func() time.Time { return now },
		RandomReader:    deterministicRandom(64),
		CleanupInterval: -1,
	})
	t.Cleanup(func() { _ = store.Close() })

	input := validInput(t)
	session, token, err := store.Create(input)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if !uuidPattern.MatchString(session.TransferID) {
		t.Fatalf("TransferID = %q, want a UUID v4", session.TransferID)
	}
	decodedToken, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("token is not base64url: %v", err)
	}
	if len(decodedToken) != TokenBytes {
		t.Fatalf("token entropy = %d bytes, want %d", len(decodedToken), TokenBytes)
	}
	if session.TokenHash != sha256.Sum256([]byte(token)) {
		t.Fatal("TokenHash does not match the returned token")
	}
	if session.FilePath != input.FilePath || session.Filename != input.Filename || session.Size != input.Size {
		t.Fatalf("session file metadata = %#v, want %#v", session, input)
	}
	if !session.CreatedAt.Equal(now.UTC()) || !session.ExpiresAt.Equal(now.UTC().Add(DefaultTTL)) {
		t.Fatalf("session lifetime = %v to %v, want %v to %v", session.CreatedAt, session.ExpiresAt, now.UTC(), now.UTC().Add(DefaultTTL))
	}
	if session.Status != StatusActive {
		t.Fatalf("Status = %q, want %q", session.Status, StatusActive)
	}
}

func TestTokenHashComparison(t *testing.T) {
	t.Parallel()

	left := hashToken("first token")
	if !tokenHashesEqual(left, hashToken("first token")) {
		t.Fatal("equal token hashes did not compare equal")
	}
	if tokenHashesEqual(left, hashToken("different token")) {
		t.Fatal("different token hashes compared equal")
	}
}

func TestStoreResolvesAndCompletesSession(t *testing.T) {
	t.Parallel()

	store := NewStore(Options{RandomReader: deterministicRandom(64), CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })

	session, token, err := store.Create(validInput(t))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	resolved, found := store.Resolve(token)
	if !found || resolved.TransferID != session.TransferID {
		t.Fatalf("Resolve() = (%#v, %v), want session %q", resolved, found, session.TransferID)
	}
	if _, found := store.Resolve("wrong token"); found {
		t.Fatal("Resolve() accepted an invalid token")
	}

	completed, err := store.Complete(session.TransferID)
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if completed.Status != StatusCompleted {
		t.Fatalf("completed Status = %q, want %q", completed.Status, StatusCompleted)
	}
	resolved, found = store.Resolve(token)
	if !found || resolved.Status != StatusCompleted {
		t.Fatalf("Resolve() after completion = (%#v, %v), want completed session", resolved, found)
	}
	if _, err := store.Complete(session.TransferID); !errors.Is(err, ErrSessionNotActive) {
		t.Fatalf("second Complete() error = %v, want ErrSessionNotActive", err)
	}
}

func TestCancelledSessionIsImmediatelyInaccessible(t *testing.T) {
	t.Parallel()

	store := NewStore(Options{RandomReader: deterministicRandom(64), CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })

	session, token, err := store.Create(validInput(t))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	cancelled, err := store.Cancel(session.TransferID)
	if err != nil {
		t.Fatalf("Cancel() error = %v", err)
	}
	if cancelled.Status != StatusCancelled {
		t.Fatalf("cancelled Status = %q, want %q", cancelled.Status, StatusCancelled)
	}
	if _, found := store.Resolve(token); found {
		t.Fatal("Resolve() returned a cancelled session")
	}
}

func TestDownloadClaimCanAbortAndRetry(t *testing.T) {
	t.Parallel()

	store := NewStore(Options{RandomReader: deterministicRandom(64), CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })

	session, token, err := store.Create(validInput(t))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	claimed, err := store.BeginDownload(session.TransferID)
	if err != nil {
		t.Fatalf("BeginDownload() error = %v", err)
	}
	if claimed.Status != StatusTransferring {
		t.Fatalf("claimed Status = %q, want %q", claimed.Status, StatusTransferring)
	}
	if _, err := store.BeginDownload(session.TransferID); !errors.Is(err, ErrSessionNotActive) {
		t.Fatalf("second BeginDownload() error = %v, want ErrSessionNotActive", err)
	}
	resolved, found := store.Resolve(token)
	if !found || resolved.Status != StatusTransferring {
		t.Fatalf("Resolve() during download = (%#v, %v), want transferring session", resolved, found)
	}
	aborted, err := store.AbortDownload(session.TransferID)
	if err != nil {
		t.Fatalf("AbortDownload() error = %v", err)
	}
	if aborted.Status != StatusActive {
		t.Fatalf("aborted Status = %q, want %q", aborted.Status, StatusActive)
	}
	if _, err := store.BeginDownload(session.TransferID); err != nil {
		t.Fatalf("BeginDownload() after abort error = %v", err)
	}
}

func TestDownloadCanCompleteAfterLinkExpires(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 21, 0, 0, 0, 0, time.UTC)
	store := NewStore(Options{
		TTL:             time.Minute,
		Clock:           func() time.Time { return now },
		RandomReader:    deterministicRandom(64),
		CleanupInterval: -1,
	})
	t.Cleanup(func() { _ = store.Close() })

	session, _, err := store.Create(validInput(t))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := store.BeginDownload(session.TransferID); err != nil {
		t.Fatalf("BeginDownload() error = %v", err)
	}
	now = now.Add(2 * time.Minute)
	if removed := store.CleanupExpired(); removed != 0 {
		t.Fatalf("CleanupExpired() removed %d in-flight sessions, want 0", removed)
	}
	completed, err := store.Complete(session.TransferID)
	if err != nil {
		t.Fatalf("Complete() after expiry error = %v", err)
	}
	if completed.Status != StatusCompleted {
		t.Fatalf("completed Status = %q, want %q", completed.Status, StatusCompleted)
	}
	if removed := store.CleanupExpired(); removed != 1 {
		t.Fatalf("CleanupExpired() after completion removed %d sessions, want 1", removed)
	}
}

func TestExpiredSessionCannotResolveAndIsCleaned(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 21, 0, 0, 0, 0, time.UTC)
	store := NewStore(Options{
		TTL:             time.Minute,
		Clock:           func() time.Time { return now },
		RandomReader:    deterministicRandom(64),
		CleanupInterval: -1,
	})
	t.Cleanup(func() { _ = store.Close() })

	_, token, err := store.Create(validInput(t))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	now = now.Add(time.Minute)
	if _, found := store.Resolve(token); found {
		t.Fatal("Resolve() returned an expired session")
	}
	if removed := store.CleanupExpired(); removed != 1 {
		t.Fatalf("CleanupExpired() = %d, want 1", removed)
	}
	if store.Count() != 0 {
		t.Fatalf("Count() = %d, want 0", store.Count())
	}
}

func TestBackgroundCleanupRemovesExpiredSession(t *testing.T) {
	store := NewStore(Options{TTL: 10 * time.Millisecond, CleanupInterval: 5 * time.Millisecond})
	t.Cleanup(func() { _ = store.Close() })

	if _, _, err := store.Create(validInput(t)); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	deadline := time.Now().Add(500 * time.Millisecond)
	for store.Count() != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if store.Count() != 0 {
		t.Fatal("background cleanup did not remove the expired session")
	}
}

func TestStoreRejectsInvalidInput(t *testing.T) {
	t.Parallel()

	store := NewStore(Options{CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })

	tests := []CreateInput{
		{FilePath: "relative.epub", Filename: "relative.epub", Size: 1},
		{FilePath: filepath.Join(t.TempDir(), "book.epub"), Size: 1},
		{FilePath: filepath.Join(t.TempDir(), "book.epub"), Filename: "book.epub", Size: 0},
	}
	for _, input := range tests {
		if _, _, err := store.Create(input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("Create(%#v) error = %v, want ErrInvalidInput", input, err)
		}
	}
}

func TestStoreCloseClearsSessionsAndRejectsCreation(t *testing.T) {
	t.Parallel()

	store := NewStore(Options{RandomReader: deterministicRandom(64), CleanupInterval: -1})
	if _, _, err := store.Create(validInput(t)); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if store.Count() != 0 {
		t.Fatalf("Count() after Close = %d, want 0", store.Count())
	}
	if _, _, err := store.Create(validInput(t)); !errors.Is(err, ErrStoreClosed) {
		t.Fatalf("Create() after Close error = %v, want ErrStoreClosed", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}
}

func TestStoreSupportsConcurrentCreationAndResolution(t *testing.T) {
	store := NewStore(Options{CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })
	input := validInput(t)

	const workers = 32
	var waitGroup sync.WaitGroup
	waitGroup.Add(workers)
	errorsChannel := make(chan error, workers)
	for range workers {
		go func() {
			defer waitGroup.Done()
			session, token, err := store.Create(input)
			if err != nil {
				errorsChannel <- err
				return
			}
			resolved, found := store.Resolve(token)
			if !found || resolved.TransferID != session.TransferID {
				errorsChannel <- errors.New("created session did not resolve")
			}
		}()
	}
	waitGroup.Wait()
	close(errorsChannel)
	for err := range errorsChannel {
		t.Errorf("concurrent operation error: %v", err)
	}
	if store.Count() != workers {
		t.Fatalf("Count() = %d, want %d", store.Count(), workers)
	}
}

func validInput(t *testing.T) CreateInput {
	t.Helper()
	return CreateInput{
		FilePath: filepath.Join(t.TempDir(), "示例.epub"),
		Filename: "示例.epub",
		Size:     123_456,
	}
}

func deterministicRandom(size int) *bytes.Reader {
	data := make([]byte, size)
	for index := range data {
		data[index] = byte(index + 1)
	}
	return bytes.NewReader(data)
}
