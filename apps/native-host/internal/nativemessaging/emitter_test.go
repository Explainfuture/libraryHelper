package nativemessaging

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
)

func TestEmitterSerializesConcurrentFrames(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	emitter := NewEmitter(&output)
	const messages = 100
	var waitGroup sync.WaitGroup
	waitGroup.Add(messages)
	for index := range messages {
		go func() {
			defer waitGroup.Done()
			transferID := fmt.Sprintf("transfer-%d", index)
			if err := emitter.Emit(protocol.CompletedEvent(transferID)); err != nil {
				t.Errorf("Emit() error = %v", err)
			}
		}()
	}
	waitGroup.Wait()

	seen := make(map[string]bool, messages)
	codec := Codec{}
	for {
		var event protocol.TransferCompletedEvent
		err := codec.Read(&output, &event)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("Read() error = %v", err)
		}
		seen[event.Payload.TransferID] = true
	}
	if len(seen) != messages {
		t.Fatalf("decoded messages = %d, want %d", len(seen), messages)
	}
}

func TestEmitterCloseRejectsFurtherMessages(t *testing.T) {
	t.Parallel()

	emitter := NewEmitter(io.Discard)
	emitter.Close()
	if err := emitter.Emit(protocol.CompletedEvent("transfer")); !errors.Is(err, ErrEmitterClosed) {
		t.Fatalf("Emit() error = %v, want ErrEmitterClosed", err)
	}
}
