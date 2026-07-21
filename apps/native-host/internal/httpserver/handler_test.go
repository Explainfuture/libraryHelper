package httpserver

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/transfer"
)

func TestMobilePageEscapesUserControlledMetadata(t *testing.T) {
	t.Parallel()

	fixture := newHandlerFixture(t, `<script>alert("x")</script>示例.epub`, []byte("epub bytes"), nil)
	response := serveRequest(fixture.handler, http.MethodGet, "/t/"+fixture.token, "192.168.1.20:50000")

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	body := response.Body.String()
	if strings.Contains(body, "<script>") {
		t.Fatal("response contains an unescaped script element")
	}
	if !strings.Contains(body, `&lt;script&gt;alert`) {
		t.Fatalf("response does not contain escaped filename: %s", body)
	}
	if strings.Contains(body, fixture.session.FilePath) {
		t.Fatal("response exposes the local file path")
	}
	for header, want := range map[string]string{
		"Content-Type":           "text/html; charset=utf-8",
		"Cache-Control":          "no-store",
		"Referrer-Policy":        "no-referrer",
		"X-Content-Type-Options": "nosniff",
	} {
		if got := response.Header().Get(header); got != want {
			t.Fatalf("%s = %q, want %q", header, got, want)
		}
	}
	if !strings.Contains(response.Header().Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatal("response is missing the restrictive Content-Security-Policy")
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("response unexpectedly enables CORS")
	}
}

func TestDownloadStreamsEPUBAndCompletesSession(t *testing.T) {
	t.Parallel()

	content := []byte("complete EPUB payload")
	completed := make(chan transfer.Session, 1)
	fixture := newHandlerFixture(t, "三体.epub", content, func(config *Config) {
		config.OnCompleted = func(session transfer.Session) { completed <- session }
	})
	response := serveRequest(fixture.handler, http.MethodGet, "/t/"+fixture.token+"/download", "192.168.1.21:50000")

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if !bytes.Equal(response.Body.Bytes(), content) {
		t.Fatalf("body = %q, want %q", response.Body.Bytes(), content)
	}
	if got := response.Header().Get("Content-Type"); got != "application/epub+zip" {
		t.Fatalf("Content-Type = %q, want application/epub+zip", got)
	}
	if got := response.Header().Get("Content-Disposition"); !strings.Contains(got, `filename*=UTF-8''%E4%B8%89%E4%BD%93.epub`) {
		t.Fatalf("Content-Disposition = %q, want UTF-8 Chinese filename", got)
	}
	if got := response.Header().Get("Content-Length"); got != strconv.Itoa(len(content)) {
		t.Fatalf("Content-Length = %q, want %d", got, len(content))
	}

	stored, found := fixture.store.Get(fixture.session.TransferID)
	if !found || stored.Status != transfer.StatusCompleted {
		t.Fatalf("stored session = (%#v, %v), want completed", stored, found)
	}
	select {
	case event := <-completed:
		if event.TransferID != fixture.session.TransferID {
			t.Fatalf("completion event ID = %q, want %q", event.TransferID, fixture.session.TransferID)
		}
	default:
		t.Fatal("completion callback was not invoked")
	}

	page := serveRequest(fixture.handler, http.MethodGet, "/t/"+fixture.token, "192.168.1.21:50001")
	if !strings.Contains(page.Body.String(), "该传输已经完成") {
		t.Fatalf("completed page body = %s", page.Body.String())
	}
	if strings.Contains(page.Body.String(), `class="button"`) {
		t.Fatal("completed page still contains a download button")
	}
}

func TestHeadRequestsDoNotCompleteTransfer(t *testing.T) {
	t.Parallel()

	content := []byte("head request payload")
	fixture := newHandlerFixture(t, "book.epub", content, nil)

	for _, path := range []string{"/t/" + fixture.token, "/t/" + fixture.token + "/download"} {
		response := serveRequest(fixture.handler, http.MethodHead, path, "192.168.1.22:50000")
		if response.Code != http.StatusOK {
			t.Fatalf("HEAD %s status = %d, want %d", path, response.Code, http.StatusOK)
		}
		if response.Body.Len() != 0 {
			t.Fatalf("HEAD %s body length = %d, want 0", path, response.Body.Len())
		}
	}
	stored, found := fixture.store.Get(fixture.session.TransferID)
	if !found || stored.Status != transfer.StatusActive {
		t.Fatalf("stored session = (%#v, %v), want active", stored, found)
	}
}

func TestInvalidTokenAndQueryReturnNotFound(t *testing.T) {
	t.Parallel()

	fixture := newHandlerFixture(t, "book.epub", []byte("epub"), nil)
	paths := []string{
		"/t/not-the-token",
		"/t/" + fixture.token + "?file=C:%5Csecret.epub",
		"/favicon.ico",
		"/t/" + fixture.token + "/extra",
	}
	for _, path := range paths {
		response := serveRequest(fixture.handler, http.MethodGet, path, "192.168.1.23:50000")
		if response.Code != http.StatusNotFound {
			t.Fatalf("GET %s status = %d, want %d", path, response.Code, http.StatusNotFound)
		}
		if strings.Contains(response.Body.String(), fixture.token) || strings.Contains(response.Body.String(), fixture.session.FilePath) {
			t.Fatalf("GET %s leaked token or local path", path)
		}
	}
	stored, _ := fixture.store.Get(fixture.session.TransferID)
	if stored.Status != transfer.StatusActive {
		t.Fatalf("Status after invalid requests = %q, want active", stored.Status)
	}
}

func TestOnlyGetAndHeadAreAllowed(t *testing.T) {
	t.Parallel()

	fixture := newHandlerFixture(t, "book.epub", []byte("epub"), nil)
	response := serveRequest(fixture.handler, http.MethodPost, "/t/"+fixture.token, "192.168.1.24:50000")
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
	if got := response.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q, want GET, HEAD", got)
	}
}

func TestFailedRequestRateLimit(t *testing.T) {
	t.Parallel()

	fixture := newHandlerFixture(t, "book.epub", []byte("epub"), func(config *Config) {
		config.FailureLimit = 2
	})
	for attempt, want := range []int{http.StatusNotFound, http.StatusNotFound, http.StatusTooManyRequests} {
		response := serveRequest(fixture.handler, http.MethodGet, "/t/invalid-token", "192.168.1.25:50000")
		if response.Code != want {
			t.Fatalf("attempt %d status = %d, want %d", attempt+1, response.Code, want)
		}
	}

	otherClient := serveRequest(fixture.handler, http.MethodGet, "/t/invalid-token", "192.168.1.26:50000")
	if otherClient.Code != http.StatusNotFound {
		t.Fatalf("other client status = %d, want %d", otherClient.Code, http.StatusNotFound)
	}
}

func TestInterruptedDownloadReturnsSessionToActive(t *testing.T) {
	t.Parallel()

	fixture := newHandlerFixture(t, "book.epub", []byte("payload that will be interrupted"), nil)
	request := httptest.NewRequest(http.MethodGet, "/t/"+fixture.token+"/download", nil)
	request.RemoteAddr = "192.168.1.27:50000"
	response := newFailingResponseWriter(5)
	fixture.handler.ServeHTTP(response, request)

	stored, found := fixture.store.Get(fixture.session.TransferID)
	if !found || stored.Status != transfer.StatusActive {
		t.Fatalf("stored session = (%#v, %v), want active after interruption", stored, found)
	}
}

func TestConcurrentDownloadIsRejected(t *testing.T) {
	fixture := newHandlerFixture(t, "book.epub", []byte("concurrent payload"), nil)
	firstRequest := httptest.NewRequest(http.MethodGet, "/t/"+fixture.token+"/download", nil)
	firstRequest.RemoteAddr = "192.168.1.28:50000"
	firstResponse := newBlockingResponseWriter()
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		fixture.handler.ServeHTTP(firstResponse, firstRequest)
	}()

	select {
	case <-firstResponse.started:
	case <-time.After(time.Second):
		t.Fatal("first download did not begin")
	}
	second := serveRequest(fixture.handler, http.MethodGet, "/t/"+fixture.token+"/download", "192.168.1.28:50001")
	if second.Code != http.StatusConflict {
		t.Fatalf("concurrent status = %d, want %d", second.Code, http.StatusConflict)
	}
	close(firstResponse.release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("first download did not finish")
	}
}

func TestMissingFileDoesNotCompleteSession(t *testing.T) {
	t.Parallel()

	fixture := newHandlerFixture(t, "book.epub", []byte("epub"), nil)
	if err := os.Remove(fixture.session.FilePath); err != nil {
		t.Fatalf("remove session file: %v", err)
	}
	response := serveRequest(fixture.handler, http.MethodGet, "/t/"+fixture.token+"/download", "192.168.1.29:50000")
	if response.Code != http.StatusGone {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusGone)
	}
	stored, _ := fixture.store.Get(fixture.session.TransferID)
	if stored.Status != transfer.StatusActive {
		t.Fatalf("Status = %q, want active", stored.Status)
	}
}

func TestContentDisposition(t *testing.T) {
	t.Parallel()

	tests := []struct {
		filename string
		want     string
	}{
		{filename: "book.epub", want: `filename="book.epub"; filename*=UTF-8''book.epub`},
		{filename: "中文 书名.epub", want: `filename*=UTF-8''%E4%B8%AD%E6%96%87%20%E4%B9%A6%E5%90%8D.epub`},
		{filename: "bad\r\nname.epub", want: `filename="bad__name.epub"`},
	}
	for _, test := range tests {
		if got := contentDisposition(test.filename); !strings.Contains(got, test.want) {
			t.Fatalf("contentDisposition(%q) = %q, want substring %q", test.filename, got, test.want)
		}
	}
}

type handlerFixture struct {
	handler http.Handler
	store   *transfer.Store
	session transfer.Session
	token   string
}

func newHandlerFixture(t *testing.T, filename string, content []byte, configure func(*Config)) handlerFixture {
	t.Helper()

	filePath := filepath.Join(t.TempDir(), "source.epub")
	if err := os.WriteFile(filePath, content, 0o600); err != nil {
		t.Fatalf("write source EPUB: %v", err)
	}
	now := time.Date(2026, time.July, 21, 12, 0, 0, 0, time.UTC)
	randomBytes := make([]byte, 64)
	for index := range randomBytes {
		randomBytes[index] = byte(index + 1)
	}
	store := transfer.NewStore(transfer.Options{
		Clock:           func() time.Time { return now },
		RandomReader:    bytes.NewReader(randomBytes),
		CleanupInterval: -1,
	})
	t.Cleanup(func() { _ = store.Close() })
	session, token, err := store.Create(transfer.CreateInput{FilePath: filePath, Filename: filename, Size: int64(len(content))})
	if err != nil {
		t.Fatalf("create transfer session: %v", err)
	}
	config := Config{Store: store, Clock: func() time.Time { return now }}
	if configure != nil {
		configure(&config)
	}
	handler, err := NewHandler(config)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	return handlerFixture{handler: handler, store: store, session: session, token: token}
}

func serveRequest(handler http.Handler, method, target, remoteAddress string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, nil)
	request.RemoteAddr = remoteAddress
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

type failingResponseWriter struct {
	header    http.Header
	status    int
	remaining int
}

func newFailingResponseWriter(bytesBeforeFailure int) *failingResponseWriter {
	return &failingResponseWriter{header: make(http.Header), remaining: bytesBeforeFailure}
}

func (writer *failingResponseWriter) Header() http.Header {
	return writer.header
}

func (writer *failingResponseWriter) WriteHeader(statusCode int) {
	writer.status = statusCode
}

func (writer *failingResponseWriter) Write(data []byte) (int, error) {
	if writer.remaining <= 0 {
		return 0, io.ErrClosedPipe
	}
	written := min(len(data), writer.remaining)
	writer.remaining -= written
	return written, io.ErrClosedPipe
}

type blockingResponseWriter struct {
	header  http.Header
	status  int
	body    bytes.Buffer
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func newBlockingResponseWriter() *blockingResponseWriter {
	return &blockingResponseWriter{
		header:  make(http.Header),
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (writer *blockingResponseWriter) Header() http.Header {
	return writer.header
}

func (writer *blockingResponseWriter) WriteHeader(statusCode int) {
	writer.status = statusCode
}

func (writer *blockingResponseWriter) Write(data []byte) (int, error) {
	writer.once.Do(func() { close(writer.started) })
	<-writer.release
	return writer.body.Write(data)
}

func TestResponseWriterHelpersImplementExpectedBehavior(t *testing.T) {
	t.Parallel()

	writer := newFailingResponseWriter(1)
	if _, err := writer.Write([]byte("ab")); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("failing writer error = %v, want io.ErrClosedPipe", err)
	}
}
