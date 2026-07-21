package httpserver

import (
	"bytes"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/transfer"
)

const maximumTokenPathLength = 128

var mobilePageTemplate = template.Must(template.New("mobile-download").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BookBridge</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f4f6f8; color: #17202a; }
    main { box-sizing: border-box; width: min(100% - 32px, 560px); margin: 40px auto; padding: 28px; border-radius: 20px; background: #fff; box-shadow: 0 12px 40px rgba(22, 34, 51, .12); }
    h1 { margin: 0 0 8px; font-size: 30px; }
    .status { margin: 0 0 24px; color: #52616f; }
    dl { display: grid; grid-template-columns: 5em 1fr; gap: 12px; margin: 0 0 24px; }
    dt { color: #667788; }
    dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-weight: 600; }
    .button { display: block; padding: 14px 18px; border-radius: 12px; background: #1769e0; color: #fff; text-align: center; text-decoration: none; font-weight: 700; }
    .notice { margin: 20px 0 0; color: #667788; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>BookBridge</h1>
    <p class="status" role="status">{{.StatusMessage}}</p>
    <dl>
      <dt>文件名</dt><dd>{{.Filename}}</dd>
      <dt>格式</dt><dd>EPUB</dd>
      <dt>大小</dt><dd>{{.Size}}</dd>
      <dt>剩余时间</dt><dd>{{.Remaining}}</dd>
    </dl>
    {{if .AllowDownload}}<a class="button" href="{{.DownloadURL}}" download>下载 EPUB</a>{{end}}
    <p class="notice">手机和电脑必须连接同一个局域网。下载完成后，可从 iOS“文件”应用使用 Apple Books 打开。</p>
  </main>
</body>
</html>`))

type downloadHandler struct {
	store       *transfer.Store
	clock       func() time.Time
	limiter     *failureLimiter
	onCompleted func(transfer.Session)
}

type pageData struct {
	Filename      string
	Size          string
	Remaining     string
	StatusMessage string
	DownloadURL   string
	AllowDownload bool
}

func NewHandler(config Config) (http.Handler, error) {
	if config.Store == nil {
		return nil, errors.New("HTTP handler requires a transfer store")
	}
	clock := config.Clock
	if clock == nil {
		clock = time.Now
	}
	handler := &downloadHandler{
		store:       config.Store,
		clock:       clock,
		limiter:     newFailureLimiter(config.FailureLimit, config.FailureWindow, config.MaxFailureClients),
		onCompleted: config.OnCompleted,
	}
	return recoverHTTPPanics(handler), nil
}

type recoveryResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (writer *recoveryResponseWriter) WriteHeader(statusCode int) {
	if writer.wroteHeader {
		return
	}
	writer.wroteHeader = true
	writer.ResponseWriter.WriteHeader(statusCode)
}

func (writer *recoveryResponseWriter) Write(data []byte) (int, error) {
	if !writer.wroteHeader {
		writer.WriteHeader(http.StatusOK)
	}
	return writer.ResponseWriter.Write(data)
}

func (writer *recoveryResponseWriter) Unwrap() http.ResponseWriter {
	return writer.ResponseWriter
}

func recoverHTTPPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writer := &recoveryResponseWriter{ResponseWriter: response}
		defer func() {
			if recover() == nil {
				return
			}
			setSecurityHeaders(writer.Header())
			if !writer.wroteHeader {
				http.Error(writer, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(writer, request)
	})
}

func (handler *downloadHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	setSecurityHeaders(response.Header())
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		response.Header().Set("Allow", "GET, HEAD")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	now := handler.clock().UTC()
	client := remoteHost(request.RemoteAddr)
	if handler.limiter.blocked(client, now) {
		retrySeconds := max(int64(handler.limiter.window/time.Second), 1)
		response.Header().Set("Retry-After", strconv.FormatInt(retrySeconds, 10))
		http.Error(response, "too many failed requests", http.StatusTooManyRequests)
		return
	}

	token, download, routeFound := parseTransferRoute(request.URL.Path)
	if !routeFound || request.URL.RawQuery != "" {
		handler.notFound(response, client, now)
		return
	}
	session, found := handler.store.Resolve(token)
	if !found {
		handler.notFound(response, client, now)
		return
	}

	if download {
		handler.serveDownload(response, request, token, session)
		return
	}
	handler.servePage(response, request, token, session, http.StatusOK)
}

func (handler *downloadHandler) servePage(response http.ResponseWriter, request *http.Request, token string, session transfer.Session, statusCode int) {
	data := pageData{
		Filename:  session.Filename,
		Size:      formatFileSize(session.Size),
		Remaining: remainingText(session.ExpiresAt.Sub(handler.clock().UTC())),
	}
	switch session.Status {
	case transfer.StatusActive:
		data.StatusMessage = "文件已准备好，可以下载。"
		data.DownloadURL = "/t/" + url.PathEscape(token) + "/download"
		data.AllowDownload = true
	case transfer.StatusTransferring:
		data.StatusMessage = "文件正在发送到手机。"
	case transfer.StatusCompleted:
		data.StatusMessage = "该传输已经完成。"
	default:
		http.NotFound(response, request)
		return
	}

	var body bytes.Buffer
	if err := mobilePageTemplate.Execute(&body, data); err != nil {
		http.Error(response, "could not render download page", http.StatusInternalServerError)
		return
	}
	response.Header().Set("Content-Type", "text/html; charset=utf-8")
	response.Header().Set("Content-Length", strconv.Itoa(body.Len()))
	response.WriteHeader(statusCode)
	if request.Method == http.MethodHead {
		return
	}
	_, _ = response.Write(body.Bytes())
}

func (handler *downloadHandler) serveDownload(response http.ResponseWriter, request *http.Request, token string, session transfer.Session) {
	if session.Status == transfer.StatusCompleted {
		handler.servePage(response, request, token, session, http.StatusOK)
		return
	}
	if session.Status == transfer.StatusTransferring {
		handler.servePage(response, request, token, session, http.StatusConflict)
		return
	}

	if request.Method == http.MethodHead {
		file, err := openSessionFile(session)
		if err != nil {
			http.Error(response, "EPUB file is no longer available", http.StatusGone)
			return
		}
		_ = file.Close()
		setDownloadHeaders(response.Header(), session)
		response.WriteHeader(http.StatusOK)
		return
	}

	claimed, err := handler.store.BeginDownload(session.TransferID)
	if err != nil {
		latest, found := handler.store.Resolve(token)
		if !found {
			http.NotFound(response, request)
			return
		}
		status := http.StatusConflict
		if latest.Status == transfer.StatusCompleted {
			status = http.StatusOK
		}
		handler.servePage(response, request, token, latest, status)
		return
	}

	completed := false
	defer func() {
		if !completed {
			_, _ = handler.store.AbortDownload(claimed.TransferID)
		}
	}()

	file, err := openSessionFile(claimed)
	if err != nil {
		http.Error(response, "EPUB file is no longer available", http.StatusGone)
		return
	}
	defer file.Close()

	setDownloadHeaders(response.Header(), claimed)
	response.WriteHeader(http.StatusOK)
	written, copyErr := io.CopyN(response, file, claimed.Size)
	if copyErr != nil || written != claimed.Size {
		return
	}

	finished, err := handler.store.Complete(claimed.TransferID)
	if err != nil {
		return
	}
	completed = true
	handler.notifyCompleted(finished)
}

func (handler *downloadHandler) notFound(response http.ResponseWriter, client string, now time.Time) {
	handler.limiter.record(client, now)
	http.Error(response, "not found", http.StatusNotFound)
}

func (handler *downloadHandler) notifyCompleted(session transfer.Session) {
	if handler.onCompleted == nil {
		return
	}
	defer func() {
		_ = recover()
	}()
	handler.onCompleted(session)
}

func openSessionFile(session transfer.Session) (*os.File, error) {
	pathInfo, err := os.Lstat(session.FilePath)
	if err != nil || !pathInfo.Mode().IsRegular() || pathInfo.Mode()&os.ModeSymlink != 0 || pathInfo.Size() != session.Size {
		return nil, errors.New("session file metadata changed")
	}
	file, err := os.Open(session.FilePath)
	if err != nil {
		return nil, err
	}
	openedInfo, err := file.Stat()
	if err != nil || !openedInfo.Mode().IsRegular() || openedInfo.Size() != session.Size || !os.SameFile(pathInfo, openedInfo) {
		_ = file.Close()
		return nil, errors.New("opened file does not match the validated session file")
	}
	return file, nil
}

func setDownloadHeaders(header http.Header, session transfer.Session) {
	header.Set("Content-Type", "application/epub+zip")
	header.Set("Content-Disposition", contentDisposition(session.Filename))
	header.Set("Content-Length", strconv.FormatInt(session.Size, 10))
	header.Set("Accept-Ranges", "none")
}

func setSecurityHeaders(header http.Header) {
	header.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Cache-Control", "no-store")
	header.Set("Cross-Origin-Resource-Policy", "same-origin")
}

func contentDisposition(filename string) string {
	var fallback strings.Builder
	for _, character := range filename {
		if character >= 0x20 && character <= 0x7e && character != '"' && character != '\\' {
			fallback.WriteRune(character)
		} else {
			fallback.WriteByte('_')
		}
	}
	if fallback.Len() == 0 || !utf8.ValidString(filename) {
		fallback.Reset()
		fallback.WriteString("book.epub")
	}
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fallback.String(), url.PathEscape(filename))
}

func parseTransferRoute(requestPath string) (string, bool, bool) {
	if !strings.HasPrefix(requestPath, "/t/") {
		return "", false, false
	}
	remainder := strings.TrimPrefix(requestPath, "/t/")
	download := false
	if strings.HasSuffix(remainder, "/download") {
		download = true
		remainder = strings.TrimSuffix(remainder, "/download")
	}
	if remainder == "" || len(remainder) > maximumTokenPathLength || strings.Contains(remainder, "/") {
		return "", false, false
	}
	return remainder, download, true
}

func remoteHost(remoteAddress string) string {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err == nil && host != "" {
		return host
	}
	if remoteAddress == "" {
		return "unknown"
	}
	return remoteAddress
}

func formatFileSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	value := float64(size)
	units := []string{"KiB", "MiB", "GiB", "TiB"}
	for _, suffix := range units {
		value /= unit
		if value < unit || suffix == units[len(units)-1] {
			return fmt.Sprintf("%.1f %s", value, suffix)
		}
	}
	return fmt.Sprintf("%d B", size)
}

func remainingText(remaining time.Duration) string {
	if remaining <= 0 {
		return "已失效"
	}
	seconds := int64((remaining + time.Second - 1) / time.Second)
	minutes := seconds / 60
	seconds %= 60
	return fmt.Sprintf("%d 分 %d 秒", minutes, seconds)
}
