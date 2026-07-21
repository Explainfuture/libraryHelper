package httpserver

import (
	"testing"
	"time"
)

func TestFailureLimiterExpiresWindowAndBoundsClients(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 21, 0, 0, 0, 0, time.UTC)
	limiter := newFailureLimiter(1, time.Minute, 2)
	limiter.record("first", now)
	limiter.record("second", now.Add(time.Second))
	if !limiter.blocked("first", now.Add(2*time.Second)) {
		t.Fatal("first client is not blocked after reaching the limit")
	}
	if limiter.blocked("second", now.Add(2*time.Minute)) {
		t.Fatal("expired failure window still blocks the client")
	}
	limiter.record("third", now.Add(3*time.Second))
	if len(limiter.entries) != 2 {
		t.Fatalf("tracked clients = %d, want 2", len(limiter.entries))
	}
}
