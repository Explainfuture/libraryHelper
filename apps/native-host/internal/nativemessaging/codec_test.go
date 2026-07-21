package nativemessaging

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestCodecRoundTrip(t *testing.T) {
	t.Parallel()

	type message struct {
		Type      string `json:"type"`
		RequestID string `json:"requestId"`
	}

	want := message{Type: "CREATE_TRANSFER", RequestID: "request-123"}
	var frame bytes.Buffer
	codec := Codec{}

	if err := codec.Write(&frame, want); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	encoded := frame.Bytes()
	if got, wantSize := binary.LittleEndian.Uint32(encoded[:4]), uint32(len(encoded)-4); got != wantSize {
		t.Fatalf("frame length = %d, want %d", got, wantSize)
	}

	var got message
	if err := codec.Read(&frame, &got); err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if got != want {
		t.Fatalf("Read() = %#v, want %#v", got, want)
	}
}

func TestCodecRejectsOversizedDeclaredMessage(t *testing.T) {
	t.Parallel()

	codec := Codec{MaxMessageSize: 8}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], 9)

	var destination map[string]any
	err := codec.Read(bytes.NewReader(header[:]), &destination)
	if !errors.Is(err, ErrMessageTooLarge) {
		t.Fatalf("Read() error = %v, want ErrMessageTooLarge", err)
	}
}

func TestCodecRejectsOversizedEncodedMessage(t *testing.T) {
	t.Parallel()

	codec := Codec{MaxMessageSize: 8}
	err := codec.Write(io.Discard, map[string]string{"value": "too large"})
	if !errors.Is(err, ErrMessageTooLarge) {
		t.Fatalf("Write() error = %v, want ErrMessageTooLarge", err)
	}
}

func TestCodecRejectsInvalidJSON(t *testing.T) {
	t.Parallel()

	payload := []byte(`{"type":`)
	var frame bytes.Buffer
	if err := binary.Write(&frame, binary.LittleEndian, uint32(len(payload))); err != nil {
		t.Fatalf("write test header: %v", err)
	}
	frame.Write(payload)

	var destination map[string]any
	err := (Codec{}).Read(&frame, &destination)
	if !errors.Is(err, ErrInvalidJSON) {
		t.Fatalf("Read() error = %v, want ErrInvalidJSON", err)
	}
}

func TestCodecRejectsTruncatedPayload(t *testing.T) {
	t.Parallel()

	var frame bytes.Buffer
	if err := binary.Write(&frame, binary.LittleEndian, uint32(10)); err != nil {
		t.Fatalf("write test header: %v", err)
	}
	frame.WriteString("{}")

	var destination map[string]any
	err := (Codec{}).Read(&frame, &destination)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("Read() error = %v, want io.ErrUnexpectedEOF", err)
	}
}

func TestCodecHandlesShortWrites(t *testing.T) {
	t.Parallel()

	writer := &shortWriter{maximum: 3}
	if err := (Codec{}).Write(writer, map[string]string{"type": "PING"}); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	var decoded map[string]string
	if err := (Codec{}).Read(bytes.NewReader(writer.data.Bytes()), &decoded); err != nil {
		t.Fatalf("Read() error = %v", err)
	}
	if decoded["type"] != "PING" {
		t.Fatalf("decoded type = %q, want PING", decoded["type"])
	}
}

func TestCodecRejectsUnencodableValue(t *testing.T) {
	t.Parallel()

	err := (Codec{}).Write(io.Discard, func() {})
	if err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("Write() error = %v, want unsupported type error", err)
	}
}

type shortWriter struct {
	maximum int
	data    bytes.Buffer
}

func (writer *shortWriter) Write(data []byte) (int, error) {
	if len(data) > writer.maximum {
		data = data[:writer.maximum]
	}
	return writer.data.Write(data)
}
