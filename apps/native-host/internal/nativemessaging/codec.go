// Package nativemessaging implements Chrome's length-prefixed native messaging
// transport. It deliberately does not perform any logging so callers can keep
// stdout reserved for protocol frames.
package nativemessaging

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const DefaultMaxMessageSize uint32 = 1 << 20

var (
	ErrInvalidJSON     = errors.New("native messaging payload is invalid JSON")
	ErrMessageTooLarge = errors.New("native messaging payload exceeds the size limit")
)

// Codec reads and writes Chrome Native Messaging frames. A zero
// MaxMessageSize uses DefaultMaxMessageSize.
type Codec struct {
	MaxMessageSize uint32
}

// Read decodes one frame from reader into destination.
func (codec Codec) Read(reader io.Reader, destination any) error {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return err
	}

	size := binary.LittleEndian.Uint32(header[:])
	maximum := codec.maximumMessageSize()
	if size > maximum {
		return fmt.Errorf("%w: got %d bytes, maximum is %d", ErrMessageTooLarge, size, maximum)
	}

	payload := make([]byte, size)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return err
	}

	if err := json.Unmarshal(payload, destination); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidJSON, err)
	}
	return nil
}

// Write encodes value as JSON and writes it as one frame to writer.
func (codec Codec) Write(writer io.Writer, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode native messaging payload: %w", err)
	}

	maximum := codec.maximumMessageSize()
	if uint64(len(payload)) > uint64(maximum) {
		return fmt.Errorf("%w: got %d bytes, maximum is %d", ErrMessageTooLarge, len(payload), maximum)
	}

	frame := make([]byte, 4+len(payload))
	binary.LittleEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)
	return writeAll(writer, frame)
}

func (codec Codec) maximumMessageSize() uint32 {
	if codec.MaxMessageSize == 0 {
		return DefaultMaxMessageSize
	}
	return codec.MaxMessageSize
}

func writeAll(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		written, err := writer.Write(data)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}
