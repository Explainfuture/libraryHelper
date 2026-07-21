package protocol

import (
	"encoding/json"
	"testing"
)

func TestDecodeCreateTransferRequest(t *testing.T) {
	t.Parallel()

	request, err := DecodeRequest(json.RawMessage(`{
        "type":"CREATE_TRANSFER",
        "requestId":"request-1",
        "payload":{"filePath":"C:\\Users\\reader\\Downloads\\book.epub","downloadId":123}
    }`))
	if err != nil {
		t.Fatalf("DecodeRequest() error = %v", err)
	}
	if request.Type != RequestCreateTransfer || request.RequestID != "request-1" || request.Create == nil {
		t.Fatalf("DecodeRequest() = %#v", request)
	}
	if request.Create.FilePath != `C:\Users\reader\Downloads\book.epub` || request.Create.DownloadID != 123 {
		t.Fatalf("create payload = %#v", request.Create)
	}
}

func TestDecodeCancelTransferRequest(t *testing.T) {
	t.Parallel()

	request, err := DecodeRequest(json.RawMessage(`{
        "type":"CANCEL_TRANSFER",
        "requestId":"request-2",
        "payload":{"transferId":"transfer-1"}
    }`))
	if err != nil {
		t.Fatalf("DecodeRequest() error = %v", err)
	}
	if request.Cancel == nil || request.Cancel.TransferID != "transfer-1" {
		t.Fatalf("cancel payload = %#v", request.Cancel)
	}
}

func TestDecodeRequestRejectsInvalidMessages(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		raw      string
		wantCode string
	}{
		{name: "missing request id", raw: `{"type":"CREATE_TRANSFER","payload":{"filePath":"book.epub","downloadId":1}}`, wantCode: "INVALID_REQUEST"},
		{name: "missing payload", raw: `{"type":"CREATE_TRANSFER","requestId":"id"}`, wantCode: "INVALID_REQUEST"},
		{name: "missing download id", raw: `{"type":"CREATE_TRANSFER","requestId":"id","payload":{"filePath":"book.epub"}}`, wantCode: "INVALID_REQUEST"},
		{name: "negative download id", raw: `{"type":"CREATE_TRANSFER","requestId":"id","payload":{"filePath":"book.epub","downloadId":-1}}`, wantCode: "INVALID_REQUEST"},
		{name: "unknown envelope field", raw: `{"type":"CREATE_TRANSFER","requestId":"id","payload":{"filePath":"book.epub","downloadId":1},"extra":true}`, wantCode: "INVALID_REQUEST"},
		{name: "unknown payload field", raw: `{"type":"CANCEL_TRANSFER","requestId":"id","payload":{"transferId":"transfer","extra":true}}`, wantCode: "INVALID_REQUEST"},
		{name: "unknown type", raw: `{"type":"DELETE_FILE","requestId":"id","payload":{}}`, wantCode: "UNKNOWN_REQUEST"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := DecodeRequest(json.RawMessage(test.raw))
			code, _ := DecodeErrorDetails(err)
			if err == nil || code != test.wantCode {
				t.Fatalf("DecodeRequest() error = %v, code = %q, want %q", err, code, test.wantCode)
			}
		})
	}
}

func TestCompletedEventIncludesRequestID(t *testing.T) {
	t.Parallel()

	event := CompletedEvent("transfer-id")
	if event.RequestID != "transfer-id" || event.Payload.TransferID != "transfer-id" {
		t.Fatalf("CompletedEvent() = %#v", event)
	}
}
