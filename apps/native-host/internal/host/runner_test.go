package host

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/nativemessaging"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
)

func TestRunnerContinuesAfterInvalidJSONAndEchoesRequestID(t *testing.T) {
	t.Parallel()

	var input bytes.Buffer
	writeRawFrame(t, &input, []byte(`{"type":`))
	codec := nativemessaging.Codec{}
	if err := codec.Write(&input, map[string]any{
		"type":      "CANCEL_TRANSFER",
		"requestId": "request-invalid",
		"payload":   map[string]any{"transferId": "transfer", "extra": true},
	}); err != nil {
		t.Fatalf("write invalid request: %v", err)
	}
	if err := codec.Write(&input, map[string]any{
		"type":      "CANCEL_TRANSFER",
		"requestId": "request-valid",
		"payload":   map[string]any{"transferId": "transfer"},
	}); err != nil {
		t.Fatalf("write valid request: %v", err)
	}

	service := &stubRequestService{}
	var output bytes.Buffer
	runner := newTestRunner(t, service, nativemessaging.NewEmitter(&output))
	if err := runner.Run(context.Background(), &input); err != nil {
		t.Fatalf("Run() error = %v", err)
	}

	responses := readRawMessages(t, &output)
	if len(responses) != 3 {
		t.Fatalf("responses = %d, want 3", len(responses))
	}
	assertRawError(t, responses[0], "", "INVALID_JSON")
	assertRawError(t, responses[1], "request-invalid", "INVALID_REQUEST")
	var cancelled protocol.TransferCancelledResponse
	if err := json.Unmarshal(responses[2], &cancelled); err != nil {
		t.Fatalf("decode success response: %v", err)
	}
	if cancelled.RequestID != "request-valid" || cancelled.Type != "TRANSFER_CANCELLED" {
		t.Fatalf("success response = %#v", cancelled)
	}
}

func TestRunnerEmitsStructuredOversizeErrorAndStops(t *testing.T) {
	t.Parallel()

	var input bytes.Buffer
	if err := binary.Write(&input, binary.LittleEndian, nativemessaging.DefaultMaxMessageSize+1); err != nil {
		t.Fatalf("write oversized header: %v", err)
	}
	var output bytes.Buffer
	runner := newTestRunner(t, &stubRequestService{}, nativemessaging.NewEmitter(&output))
	err := runner.Run(context.Background(), &input)
	if !errors.Is(err, nativemessaging.ErrMessageTooLarge) {
		t.Fatalf("Run() error = %v, want ErrMessageTooLarge", err)
	}
	responses := readRawMessages(t, &output)
	if len(responses) != 1 {
		t.Fatalf("responses = %d, want 1", len(responses))
	}
	assertRawError(t, responses[0], "", "MESSAGE_TOO_LARGE")
}

func TestRunnerDrainsRetainedTransfersAfterEOF(t *testing.T) {
	t.Parallel()

	service := &stubRequestService{}
	service.retained.Store(1)
	runner := newTestRunner(t, service, nativemessaging.NewEmitter(io.Discard))
	finished := make(chan error, 1)
	go func() { finished <- runner.Run(context.Background(), bytes.NewReader(nil)) }()

	select {
	case <-finished:
		t.Fatal("Run() returned before retained transfer drained")
	case <-time.After(20 * time.Millisecond):
	}
	service.retained.Store(0)
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("Run() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Run() did not return after retained transfer drained")
	}
}

func TestRunnerRecoversRequestHandlerPanic(t *testing.T) {
	t.Parallel()

	var input bytes.Buffer
	codec := nativemessaging.Codec{}
	if err := codec.Write(&input, map[string]any{
		"type":      "CANCEL_TRANSFER",
		"requestId": "request-panic",
		"payload":   map[string]any{"transferId": "transfer"},
	}); err != nil {
		t.Fatalf("write request: %v", err)
	}
	var output bytes.Buffer
	runner := newTestRunner(t, &stubRequestService{panicOnHandle: true}, nativemessaging.NewEmitter(&output))
	if err := runner.Run(context.Background(), &input); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	responses := readRawMessages(t, &output)
	assertRawError(t, responses[0], "request-panic", "INTERNAL_ERROR")
}

type stubRequestService struct {
	retained      atomic.Int64
	panicOnHandle bool
}

func (service *stubRequestService) Handle(request protocol.Request) any {
	if service.panicOnHandle {
		panic("test panic")
	}
	return protocol.TransferCancelledResponse{
		Type:      "TRANSFER_CANCELLED",
		RequestID: request.RequestID,
		Payload:   protocol.TransferCancelledPayload{TransferID: request.Cancel.TransferID},
	}
}

func (service *stubRequestService) RetainedCount() int {
	return int(service.retained.Load())
}

func newTestRunner(t *testing.T, service RequestService, emitter MessageEmitter) *Runner {
	t.Helper()
	runner, err := NewRunner(RunnerOptions{Service: service, Emitter: emitter, DrainInterval: 5 * time.Millisecond})
	if err != nil {
		t.Fatalf("NewRunner() error = %v", err)
	}
	return runner
}

func writeRawFrame(t *testing.T, writer io.Writer, payload []byte) {
	t.Helper()
	if err := binary.Write(writer, binary.LittleEndian, uint32(len(payload))); err != nil {
		t.Fatalf("write frame header: %v", err)
	}
	if _, err := writer.Write(payload); err != nil {
		t.Fatalf("write frame payload: %v", err)
	}
}

func readRawMessages(t *testing.T, reader io.Reader) []json.RawMessage {
	t.Helper()
	codec := nativemessaging.Codec{}
	var messages []json.RawMessage
	for {
		var raw json.RawMessage
		err := codec.Read(reader, &raw)
		if errors.Is(err, io.EOF) {
			return messages
		}
		if err != nil {
			t.Fatalf("read response: %v", err)
		}
		messages = append(messages, raw)
	}
}

func assertRawError(t *testing.T, raw json.RawMessage, requestID, code string) {
	t.Helper()
	var response protocol.ErrorResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if response.RequestID != requestID || response.Error.Code != code {
		t.Fatalf("error response = %#v, want requestId %q code %q", response, requestID, code)
	}
}
