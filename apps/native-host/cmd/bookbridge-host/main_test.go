package main

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/epub"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/httpserver"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/lan"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/nativemessaging"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
)

func TestRunCreatesDownloadAndEmitsCompletion(t *testing.T) {
	t.Parallel()

	filePath := writeTestEPUB(t)
	wantContent, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read EPUB fixture: %v", err)
	}
	port := reserveTCPPort(t)
	inputReader, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	t.Cleanup(func() {
		_ = inputReader.Close()
		_ = inputWriter.Close()
		_ = outputReader.Close()
		_ = outputWriter.Close()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	runErrors := make(chan error, 1)
	go func() {
		runErrors <- runWithServerStarter(ctx, inputReader, outputWriter, io.Discard, func(config httpserver.Config) (localServer, error) {
			config.LANIP = net.ParseIP("192.168.1.42")
			config.Port = port
			config.PortAttempts = 1
			return httpserver.Listen(config)
		})
	}()

	codec := nativemessaging.Codec{}
	if err := codec.Write(inputWriter, map[string]any{
		"type":      "CREATE_TRANSFER",
		"requestId": "request-e2e",
		"payload":   map[string]any{"filePath": filePath, "downloadId": 42},
	}); err != nil {
		t.Fatalf("write create request: %v", err)
	}

	var created protocol.TransferCreatedResponse
	if err := codec.Read(outputReader, &created); err != nil {
		t.Fatalf("read create response: %v", err)
	}
	if created.Type != "TRANSFER_CREATED" || created.RequestID != "request-e2e" {
		t.Fatalf("created response = %#v", created)
	}

	downloadURL, err := url.Parse(created.Payload.URL + "/download")
	if err != nil {
		t.Fatalf("parse download URL: %v", err)
	}
	downloadURL.Host = net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	type completionResult struct {
		event protocol.TransferCompletedEvent
		err   error
	}
	completionResults := make(chan completionResult, 1)
	go func() {
		var completed protocol.TransferCompletedEvent
		readErr := codec.Read(outputReader, &completed)
		completionResults <- completionResult{event: completed, err: readErr}
	}()
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(downloadURL.String())
	if err != nil {
		t.Fatalf("download EPUB: %v", err)
	}
	content, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	if readErr != nil || closeErr != nil {
		t.Fatalf("read download: %v; close: %v", readErr, closeErr)
	}
	if response.StatusCode != http.StatusOK || !bytes.Equal(content, wantContent) {
		t.Fatalf("download status = %d, bytes = %d, want %d", response.StatusCode, len(content), len(wantContent))
	}

	completion := <-completionResults
	if completion.err != nil {
		t.Fatalf("read completion event: %v", completion.err)
	}
	if completion.event.Type != "TRANSFER_COMPLETED" || completion.event.Payload.TransferID != created.Payload.TransferID {
		t.Fatalf("completion event = %#v", completion.event)
	}
	if err := inputWriter.Close(); err != nil {
		t.Fatalf("close native input: %v", err)
	}

	select {
	case err := <-runErrors:
		if err != nil {
			t.Fatalf("runWithServerStarter() error = %v", err)
		}
	case <-ctx.Done():
		t.Fatal("native host did not stop after completed transfer")
	}
}

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

func reserveTCPPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve TCP port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release TCP port: %v", err)
	}
	return port
}
