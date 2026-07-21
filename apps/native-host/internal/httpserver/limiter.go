package httpserver

import (
	"sync"
	"time"
)

type failureEntry struct {
	count     int
	windowEnd time.Time
}

// failureLimiter bounds repeated invalid-token attempts per remote IP. It only
// tracks failures and caps the client map to avoid unbounded memory growth.
type failureLimiter struct {
	mu         sync.Mutex
	entries    map[string]failureEntry
	limit      int
	window     time.Duration
	maxClients int
}

func newFailureLimiter(limit int, window time.Duration, maxClients int) *failureLimiter {
	if limit <= 0 {
		limit = DefaultFailureLimit
	}
	if window <= 0 {
		window = DefaultFailureWindow
	}
	if maxClients <= 0 {
		maxClients = DefaultMaxFailureClients
	}
	return &failureLimiter{
		entries:    make(map[string]failureEntry),
		limit:      limit,
		window:     window,
		maxClients: maxClients,
	}
}

func (limiter *failureLimiter) blocked(client string, now time.Time) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	entry, found := limiter.entries[client]
	if !found {
		return false
	}
	if !now.Before(entry.windowEnd) {
		delete(limiter.entries, client)
		return false
	}
	return entry.count >= limiter.limit
}

func (limiter *failureLimiter) record(client string, now time.Time) {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	entry, found := limiter.entries[client]
	if !found || !now.Before(entry.windowEnd) {
		if !found && len(limiter.entries) >= limiter.maxClients {
			limiter.evictOldestLocked()
		}
		limiter.entries[client] = failureEntry{count: 1, windowEnd: now.Add(limiter.window)}
		return
	}
	entry.count++
	limiter.entries[client] = entry
}

func (limiter *failureLimiter) evictOldestLocked() {
	var oldestClient string
	var oldestEnd time.Time
	for client, entry := range limiter.entries {
		if oldestClient == "" || entry.windowEnd.Before(oldestEnd) {
			oldestClient = client
			oldestEnd = entry.windowEnd
		}
	}
	if oldestClient != "" {
		delete(limiter.entries, oldestClient)
	}
}
