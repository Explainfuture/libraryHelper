package nativemessaging

import (
	"errors"
	"io"
	"sync"
)

var ErrEmitterClosed = errors.New("native messaging emitter is closed")

// Emitter serializes complete Native Messaging frames so request responses and
// asynchronous transfer events cannot interleave on stdout.
type Emitter struct {
	mu     sync.Mutex
	codec  Codec
	writer io.Writer
	closed bool
}

func NewEmitter(writer io.Writer) *Emitter {
	return &Emitter{writer: writer}
}

func (emitter *Emitter) Emit(message any) error {
	emitter.mu.Lock()
	defer emitter.mu.Unlock()
	if emitter.closed {
		return ErrEmitterClosed
	}
	if err := emitter.codec.Write(emitter.writer, message); err != nil {
		emitter.closed = true
		return err
	}
	return nil
}

func (emitter *Emitter) Close() {
	emitter.mu.Lock()
	emitter.closed = true
	emitter.mu.Unlock()
}
