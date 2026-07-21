package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/nativemessaging"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
)

const defaultDrainInterval = 100 * time.Millisecond

type RequestService interface {
	Handle(protocol.Request) any
	RetainedCount() int
}

type MessageEmitter interface {
	Emit(any) error
	Close()
}

type RunnerOptions struct {
	Service       RequestService
	Emitter       MessageEmitter
	Codec         nativemessaging.Codec
	DrainInterval time.Duration
}

type Runner struct {
	service       RequestService
	emitter       MessageEmitter
	codec         nativemessaging.Codec
	drainInterval time.Duration
}

func NewRunner(options RunnerOptions) (*Runner, error) {
	if options.Service == nil || options.Emitter == nil {
		return nil, errors.New("native host runner requires a service and emitter")
	}
	drainInterval := options.DrainInterval
	if drainInterval <= 0 {
		drainInterval = defaultDrainInterval
	}
	return &Runner{
		service:       options.Service,
		emitter:       options.Emitter,
		codec:         options.Codec,
		drainInterval: drainInterval,
	}, nil
}

// Run processes frames until stdin closes. It then disables protocol output
// but keeps active HTTP transfers alive until completion, expiry, or context
// cancellation.
func (runner *Runner) Run(ctx context.Context, reader io.Reader) error {
	for {
		if ctx.Err() != nil {
			runner.emitter.Close()
			return nil
		}

		var raw json.RawMessage
		err := runner.codec.Read(reader, &raw)
		switch {
		case errors.Is(err, io.EOF):
			runner.emitter.Close()
			return runner.drain(ctx)
		case errors.Is(err, nativemessaging.ErrInvalidJSON):
			if emitErr := runner.emitter.Emit(protocol.Error("", "INVALID_JSON", "message payload is not valid JSON")); emitErr != nil {
				return fmt.Errorf("emit invalid JSON response: %w", emitErr)
			}
			continue
		case errors.Is(err, nativemessaging.ErrMessageTooLarge):
			if emitErr := runner.emitter.Emit(protocol.Error("", "MESSAGE_TOO_LARGE", "message exceeds the 1 MB limit")); emitErr != nil {
				return errors.Join(err, emitErr)
			}
			return err
		case err != nil:
			return fmt.Errorf("read native message: %w", err)
		}

		request, decodeErr := protocol.DecodeRequest(raw)
		if decodeErr != nil {
			code, message := protocol.DecodeErrorDetails(decodeErr)
			if emitErr := runner.emitter.Emit(protocol.Error(protocol.ExtractRequestID(raw), code, message)); emitErr != nil {
				return fmt.Errorf("emit request validation error: %w", emitErr)
			}
			continue
		}

		response := runner.handleSafely(request)
		if emitErr := runner.emitter.Emit(response); emitErr != nil {
			return fmt.Errorf("emit native response: %w", emitErr)
		}
	}
}

func (runner *Runner) handleSafely(request protocol.Request) (response any) {
	defer func() {
		if recover() != nil {
			response = protocol.Error(request.RequestID, "INTERNAL_ERROR", "request processing failed")
		}
	}()
	return runner.service.Handle(request)
}

func (runner *Runner) drain(ctx context.Context) error {
	if runner.service.RetainedCount() == 0 {
		return nil
	}
	ticker := time.NewTicker(runner.drainInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if runner.service.RetainedCount() == 0 {
				return nil
			}
		}
	}
}
