package host

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/epub"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/lan"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/transfer"
)

func TestServiceCreatesAndCancelsTransfer(t *testing.T) {
	t.Parallel()

	filePath := writeValidEPUB(t, "示例.epub")
	store := transfer.NewStore(transfer.Options{CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewService(ServiceOptions{
		Store: store,
		URL:   func(token string) string { return "http://192.168.1.42:18321/t/" + token },
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	response := service.Handle(protocol.Request{
		Type:      protocol.RequestCreateTransfer,
		RequestID: "request-create",
		Create:    &protocol.CreateTransferPayload{FilePath: filePath, DownloadID: 7},
	})
	created, ok := response.(protocol.TransferCreatedResponse)
	if !ok {
		t.Fatalf("create response = %#v, want TransferCreatedResponse", response)
	}
	if created.RequestID != "request-create" || created.Payload.Filename != "示例.epub" || created.Payload.Size <= 0 {
		t.Fatalf("created response = %#v", created)
	}
	token := strings.TrimPrefix(created.Payload.URL, "http://192.168.1.42:18321/t/")
	session, found := store.Resolve(token)
	if !found || session.TransferID != created.Payload.TransferID {
		t.Fatalf("Resolve() = (%#v, %v), want %q", session, found, created.Payload.TransferID)
	}
	if service.RetainedCount() != 1 {
		t.Fatalf("RetainedCount() = %d, want 1", service.RetainedCount())
	}

	cancelResponse := service.Handle(protocol.Request{
		Type:      protocol.RequestCancelTransfer,
		RequestID: "request-cancel",
		Cancel:    &protocol.CancelTransferPayload{TransferID: created.Payload.TransferID},
	})
	cancelled, ok := cancelResponse.(protocol.TransferCancelledResponse)
	if !ok || cancelled.Payload.TransferID != created.Payload.TransferID || cancelled.RequestID != "request-cancel" {
		t.Fatalf("cancel response = %#v", cancelResponse)
	}
	if _, found := store.Resolve(token); found {
		t.Fatal("cancelled token still resolves")
	}
}

func TestServiceRejectsInvalidEPUB(t *testing.T) {
	t.Parallel()

	store := transfer.NewStore(transfer.Options{CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewService(ServiceOptions{Store: store, URL: func(string) string { return "http://example.invalid" }})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	response := service.Handle(protocol.Request{
		Type:      protocol.RequestCreateTransfer,
		RequestID: "request-invalid",
		Create:    &protocol.CreateTransferPayload{FilePath: filepath.Join(t.TempDir(), "missing.epub")},
	})
	assertErrorCode(t, response, "INVALID_EPUB")
}

func TestServiceMapsHTTPStartupErrors(t *testing.T) {
	t.Parallel()

	validated := epub.File{Path: filepath.Join(t.TempDir(), "book.epub"), Filename: "book.epub", Size: 1}
	tests := []struct {
		name       string
		startupErr error
		wantCode   string
	}{
		{name: "no LAN", startupErr: lan.ErrNoLANAddress, wantCode: "NO_LAN_ADDRESS"},
		{name: "bind failure", startupErr: errors.New("bind failed"), wantCode: "HTTP_SERVER_UNAVAILABLE"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			store := transfer.NewStore(transfer.Options{CleanupInterval: -1})
			t.Cleanup(func() { _ = store.Close() })
			service, err := NewService(ServiceOptions{
				Store:        store,
				Validate:     func(string) (epub.File, error) { return validated, nil },
				StartupError: test.startupErr,
			})
			if err != nil {
				t.Fatalf("NewService() error = %v", err)
			}
			response := service.Handle(protocol.Request{
				Type:      protocol.RequestCreateTransfer,
				RequestID: "request",
				Create:    &protocol.CreateTransferPayload{FilePath: validated.Path},
			})
			assertErrorCode(t, response, test.wantCode)
		})
	}
}

func TestServiceReportsMissingTransfer(t *testing.T) {
	t.Parallel()

	store := transfer.NewStore(transfer.Options{CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewService(ServiceOptions{Store: store})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	response := service.Handle(protocol.Request{
		Type:      protocol.RequestCancelTransfer,
		RequestID: "request",
		Cancel:    &protocol.CancelTransferPayload{TransferID: "missing"},
	})
	assertErrorCode(t, response, "TRANSFER_NOT_FOUND")
}

func assertErrorCode(t *testing.T, response any, want string) {
	t.Helper()
	protocolError, ok := response.(protocol.ErrorResponse)
	if !ok || protocolError.Error.Code != want {
		t.Fatalf("response = %#v, want error code %q", response, want)
	}
}

func writeValidEPUB(t *testing.T, filename string) string {
	t.Helper()
	filePath := filepath.Join(t.TempDir(), filename)
	file, err := os.Create(filePath)
	if err != nil {
		t.Fatalf("create EPUB: %v", err)
	}
	archive := zip.NewWriter(file)
	entry, err := archive.Create(epub.ContainerPath)
	if err != nil {
		t.Fatalf("create container entry: %v", err)
	}
	if _, err := entry.Write([]byte("<container/>")); err != nil {
		t.Fatalf("write container entry: %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close EPUB: %v", err)
	}
	return filePath
}

func TestServiceExpiryTimestampUsesMilliseconds(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 21, 0, 0, 0, 123_000_000, time.UTC)
	store := transfer.NewStore(transfer.Options{Clock: func() time.Time { return now }, CleanupInterval: -1})
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewService(ServiceOptions{
		Store: store,
		Validate: func(string) (epub.File, error) {
			return epub.File{Path: filepath.Join(t.TempDir(), "book.epub"), Filename: "book.epub", Size: 1}, nil
		},
		URL: func(string) string { return "http://192.168.1.1/t/token" },
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	response := service.Handle(protocol.Request{Type: protocol.RequestCreateTransfer, RequestID: "request", Create: &protocol.CreateTransferPayload{FilePath: "ignored"}})
	created, ok := response.(protocol.TransferCreatedResponse)
	if !ok {
		t.Fatalf("response = %#v", response)
	}
	if created.Payload.ExpiresAt != now.Add(transfer.DefaultTTL).UnixMilli() {
		t.Fatalf("ExpiresAt = %d, want %d", created.Payload.ExpiresAt, now.Add(transfer.DefaultTTL).UnixMilli())
	}
}
