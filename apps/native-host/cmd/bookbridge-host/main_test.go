package main

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/epub"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/httpserver"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/lan"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/nativemessaging"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
)

func TestRunKeepsDiagnosticsOutOfProtocolOutput(t *testing.T) {
	t.Parallel()

	filePath := writeTestEPUB(t)
	var input bytes.Buffer
	codec := nativemessaging.Codec{}
	if err := codec.Write(&input, map[string]any{
		"type":      "CREATE_TRANSFER",
		"requestId": "request-1",
		"payload":   map[string]any{"filePath": filePath, "downloadId": 1},
	}); err != nil {
		t.Fatalf("write request: %v", err)
	}
	var output bytes.Buffer
	var diagnostics bytes.Buffer
	err := runWithServerStarter(context.Background(), &input, &output, &diagnostics, func(httpserver.Config) (localServer, error) {
		return nil, lan.ErrNoLANAddress
	})
	if err != nil {
		t.Fatalf("runWithServerStarter() error = %v", err)
	}

	var response protocol.ErrorResponse
	if err := codec.Read(&output, &response); err != nil {
		t.Fatalf("read protocol response: %v", err)
	}
	if response.RequestID != "request-1" || response.Error.Code != "NO_LAN_ADDRESS" {
		t.Fatalf("protocol response = %#v", response)
	}
	var extra protocol.ErrorResponse
	if err := codec.Read(&output, &extra); !errors.Is(err, io.EOF) {
		t.Fatalf("extra stdout data: %v", err)
	}
	if !strings.Contains(diagnostics.String(), "local HTTP server unavailable") {
		t.Fatalf("diagnostics = %q, want startup error", diagnostics.String())
	}
}

func TestRunClosesHTTPServerAfterEmptyInput(t *testing.T) {
	t.Parallel()

	server := &fakeLocalServer{}
	var output bytes.Buffer
	err := runWithServerStarter(context.Background(), bytes.NewReader(nil), &output, io.Discard, func(httpserver.Config) (localServer, error) {
		return server, nil
	})
	if err != nil {
		t.Fatalf("runWithServerStarter() error = %v", err)
	}
	if !server.closed.Load() {
		t.Fatal("HTTP server was not closed")
	}
	if output.Len() != 0 {
		t.Fatalf("stdout contains %d bytes for empty input", output.Len())
	}
}

type fakeLocalServer struct {
	closed atomic.Bool
}

func (server *fakeLocalServer) URL(token string) string {
	return "http://192.168.1.42:18321/t/" + token
}

func (server *fakeLocalServer) Close(context.Context) error {
	server.closed.Store(true)
	return nil
}

func writeTestEPUB(t *testing.T) string {
	t.Helper()
	filePath := filepath.Join(t.TempDir(), "book.epub")
	file, err := os.Create(filePath)
	if err != nil {
		t.Fatalf("create EPUB: %v", err)
	}
	archive := zip.NewWriter(file)
	entry, err := archive.Create(epub.ContainerPath)
	if err != nil {
		t.Fatalf("create container: %v", err)
	}
	if _, err := entry.Write([]byte("<container/>")); err != nil {
		t.Fatalf("write container: %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close file: %v", err)
	}
	return filePath
}
