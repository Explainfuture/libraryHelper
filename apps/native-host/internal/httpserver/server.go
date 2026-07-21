// Package httpserver serves short-lived EPUB downloads on the local network.
package httpserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/lan"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/transfer"
)

const (
	DefaultPort              = 18_321
	DefaultPortAttempts      = 10
	DefaultFailureLimit      = 20
	DefaultFailureWindow     = time.Minute
	DefaultMaxFailureClients = 2_048

	readHeaderTimeout = 5 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 10 * time.Minute
	idleTimeout       = 60 * time.Second
	maxHeaderBytes    = 16 << 10
)

type Config struct {
	Store             *transfer.Store
	LANIP             net.IP
	Port              int
	PortAttempts      int
	Clock             func() time.Time
	OnCompleted       func(transfer.Session)
	FailureLimit      int
	FailureWindow     time.Duration
	MaxFailureClients int
}

type Server struct {
	httpServer *http.Server
	listener   net.Listener
	lanIP      net.IP
	port       int
	done       chan error
}

// Listen starts the HTTP service on 0.0.0.0, trying a bounded sequence of
// ports beginning at 18321 by default.
func Listen(config Config) (*Server, error) {
	if config.Store == nil {
		return nil, errors.New("HTTP server requires a transfer store")
	}

	var lanIP net.IP
	if len(config.LANIP) == 0 {
		var err error
		lanIP, err = lan.DiscoverPrivateIPv4()
		if err != nil {
			return nil, err
		}
	} else {
		lanIP = config.LANIP.To4()
		if lanIP == nil || !lanIP.IsPrivate() {
			return nil, lan.ErrNoLANAddress
		}
	}

	handler, err := NewHandler(config)
	if err != nil {
		return nil, err
	}
	basePort, attempts, err := normalizedPortRange(config.Port, config.PortAttempts)
	if err != nil {
		return nil, err
	}
	listener, selectedPort, err := listenWithRetries(basePort, attempts, net.Listen)
	if err != nil {
		return nil, err
	}

	httpServer := configuredHTTPServer(handler)
	server := &Server{
		httpServer: httpServer,
		listener:   listener,
		lanIP:      append(net.IP(nil), lanIP...),
		port:       selectedPort,
		done:       make(chan error, 1),
	}
	go func() {
		serveErr := httpServer.Serve(listener)
		if errors.Is(serveErr, http.ErrServerClosed) {
			serveErr = nil
		}
		server.done <- serveErr
		close(server.done)
	}()
	return server, nil
}

func (server *Server) URL(token string) string {
	host := net.JoinHostPort(server.lanIP.String(), strconv.Itoa(server.port))
	return "http://" + host + "/t/" + url.PathEscape(token)
}

func (server *Server) Port() int {
	return server.port
}

func (server *Server) LANIP() net.IP {
	return append(net.IP(nil), server.lanIP...)
}

func (server *Server) Done() <-chan error {
	return server.done
}

func (server *Server) Close(ctx context.Context) error {
	return server.httpServer.Shutdown(ctx)
}

func configuredHTTPServer(handler http.Handler) *http.Server {
	return &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		MaxHeaderBytes:    maxHeaderBytes,
	}
}

type listenerFactory func(network, address string) (net.Listener, error)

func listenWithRetries(basePort, attempts int, listen listenerFactory) (net.Listener, int, error) {
	var lastErr error
	for offset := 0; offset < attempts; offset++ {
		port := basePort + offset
		address := net.JoinHostPort("0.0.0.0", strconv.Itoa(port))
		listener, err := listen("tcp4", address)
		if err == nil {
			return listener, port, nil
		}
		lastErr = err
	}
	return nil, 0, fmt.Errorf("listen on ports %d-%d: %w", basePort, basePort+attempts-1, lastErr)
}

func normalizedPortRange(port, attempts int) (int, int, error) {
	if port == 0 {
		port = DefaultPort
	}
	if attempts == 0 {
		attempts = DefaultPortAttempts
	}
	if port < 1 || port > 65_535 || attempts < 1 || port+attempts-1 > 65_535 {
		return 0, 0, errors.New("invalid HTTP port retry range")
	}
	return port, attempts, nil
}
