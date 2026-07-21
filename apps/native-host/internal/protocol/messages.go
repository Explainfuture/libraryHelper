// Package protocol defines and validates messages exchanged with the Chrome
// extension over Native Messaging.
package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const maximumIdentifierLength = 128

type RequestType string

const (
	RequestCreateTransfer RequestType = "CREATE_TRANSFER"
	RequestCancelTransfer RequestType = "CANCEL_TRANSFER"
)

type Request struct {
	Type      RequestType
	RequestID string
	Create    *CreateTransferPayload
	Cancel    *CancelTransferPayload
}

type CreateTransferPayload struct {
	FilePath   string `json:"filePath"`
	DownloadID int64  `json:"downloadId"`
}

type CancelTransferPayload struct {
	TransferID string `json:"transferId"`
}

type TransferCreatedResponse struct {
	Type      string                 `json:"type"`
	RequestID string                 `json:"requestId"`
	Payload   TransferCreatedPayload `json:"payload"`
}

type TransferCreatedPayload struct {
	TransferID string `json:"transferId"`
	URL        string `json:"url"`
	Filename   string `json:"filename"`
	Size       int64  `json:"size"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type TransferCancelledResponse struct {
	Type      string                   `json:"type"`
	RequestID string                   `json:"requestId"`
	Payload   TransferCancelledPayload `json:"payload"`
}

type TransferCancelledPayload struct {
	TransferID string `json:"transferId"`
}

type TransferCompletedEvent struct {
	Type      string                   `json:"type"`
	RequestID string                   `json:"requestId"`
	Payload   TransferCompletedPayload `json:"payload"`
}

type TransferCompletedPayload struct {
	TransferID string `json:"transferId"`
}

type ErrorResponse struct {
	Type      string       `json:"type"`
	RequestID string       `json:"requestId"`
	Error     ErrorPayload `json:"error"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type DecodeError struct {
	Code    string
	Message string
}

func (err *DecodeError) Error() string {
	return err.Message
}

type requestEnvelope struct {
	Type      RequestType     `json:"type"`
	RequestID string          `json:"requestId"`
	Payload   json.RawMessage `json:"payload"`
}

type createTransferWire struct {
	FilePath   string `json:"filePath"`
	DownloadID *int64 `json:"downloadId"`
}

// DecodeRequest rejects unknown fields and validates the tagged payload.
func DecodeRequest(raw json.RawMessage) (Request, error) {
	var envelope requestEnvelope
	if err := decodeStrict(raw, &envelope); err != nil {
		return Request{}, &DecodeError{Code: "INVALID_REQUEST", Message: "request envelope is invalid"}
	}
	if strings.TrimSpace(envelope.RequestID) == "" || len(envelope.RequestID) > maximumIdentifierLength {
		return Request{}, &DecodeError{Code: "INVALID_REQUEST", Message: "requestId is required"}
	}
	if len(envelope.Payload) == 0 || bytes.Equal(bytes.TrimSpace(envelope.Payload), []byte("null")) {
		return Request{}, &DecodeError{Code: "INVALID_REQUEST", Message: "payload is required"}
	}

	request := Request{Type: envelope.Type, RequestID: envelope.RequestID}
	switch envelope.Type {
	case RequestCreateTransfer:
		var payload createTransferWire
		if err := decodeStrict(envelope.Payload, &payload); err != nil || strings.TrimSpace(payload.FilePath) == "" || payload.DownloadID == nil || *payload.DownloadID < 0 {
			return Request{}, &DecodeError{Code: "INVALID_REQUEST", Message: "CREATE_TRANSFER payload is invalid"}
		}
		request.Create = &CreateTransferPayload{FilePath: payload.FilePath, DownloadID: *payload.DownloadID}
	case RequestCancelTransfer:
		var payload CancelTransferPayload
		if err := decodeStrict(envelope.Payload, &payload); err != nil || strings.TrimSpace(payload.TransferID) == "" || len(payload.TransferID) > maximumIdentifierLength {
			return Request{}, &DecodeError{Code: "INVALID_REQUEST", Message: "CANCEL_TRANSFER payload is invalid"}
		}
		request.Cancel = &payload
	default:
		return Request{}, &DecodeError{Code: "UNKNOWN_REQUEST", Message: fmt.Sprintf("unsupported request type %q", envelope.Type)}
	}
	return request, nil
}

func Error(requestID, code, message string) ErrorResponse {
	return ErrorResponse{
		Type:      "ERROR",
		RequestID: requestID,
		Error:     ErrorPayload{Code: code, Message: message},
	}
}

func CompletedEvent(transferID string) TransferCompletedEvent {
	return TransferCompletedEvent{
		Type:      "TRANSFER_COMPLETED",
		RequestID: transferID,
		Payload:   TransferCompletedPayload{TransferID: transferID},
	}
}

func DecodeErrorDetails(err error) (string, string) {
	var decodeErr *DecodeError
	if errors.As(err, &decodeErr) {
		return decodeErr.Code, decodeErr.Message
	}
	return "INVALID_REQUEST", "request is invalid"
}

// ExtractRequestID performs a best-effort lookup for error responses when the
// full request shape is invalid.
func ExtractRequestID(raw json.RawMessage) string {
	var envelope struct {
		RequestID string `json:"requestId"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || len(envelope.RequestID) > maximumIdentifierLength {
		return ""
	}
	return envelope.RequestID
}

func decodeStrict(raw []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
