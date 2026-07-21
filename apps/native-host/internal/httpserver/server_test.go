package httpserver

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
)

func TestListenWithRetriesUsesBoundedNextPort(t *testing.T) {
	t.Parallel()

	var addresses []string
	wantListener := &stubListener{address: stubAddress("selected")}
	listener, port, err := listenWithRetries(18_321, 3, func(network, address string) (net.Listener, error) {
		if network != "tcp4" {
			t.Fatalf("network = %q, want tcp4", network)
		}
		addresses = append(addresses, address)
		if len(addresses) < 3 {
			return nil, errors.New("port occupied")
		}
		return wantListener, nil
	})
	if err != nil {
		t.Fatalf("listenWithRetries() error = %v", err)
	}
	if listener != wantListener || port != 18_323 {
		t.Fatalf("listenWithRetries() = (%v, %d), want selected listener on 18323", listener, port)
	}
	wantAddresses := []string{"0.0.0.0:18321", "0.0.0.0:18322", "0.0.0.0:18323"}
	if strings.Join(addresses, ",") != strings.Join(wantAddresses, ",") {
		t.Fatalf("addresses = %v, want %v", addresses, wantAddresses)
	}
}

func TestListenWithRetriesStopsAfterLimit(t *testing.T) {
	t.Parallel()

	calls := 0
	_, _, err := listenWithRetries(18_321, 2, func(_, _ string) (net.Listener, error) {
		calls++
		return nil, errors.New("port occupied")
	})
	if err == nil || calls != 2 {
		t.Fatalf("listenWithRetries() error = %v, calls = %d, want error after 2 calls", err, calls)
	}
}

func TestNormalizedPortRange(t *testing.T) {
	t.Parallel()

	port, attempts, err := normalizedPortRange(0, 0)
	if err != nil || port != DefaultPort || attempts != DefaultPortAttempts {
		t.Fatalf("normalizedPortRange(0, 0) = (%d, %d, %v)", port, attempts, err)
	}
	invalid := [][2]int{{-1, 1}, {65_536, 1}, {65_535, 2}, {18_321, -1}}
	for _, values := range invalid {
		if _, _, err := normalizedPortRange(values[0], values[1]); err == nil {
			t.Fatalf("normalizedPortRange(%d, %d) accepted invalid range", values[0], values[1])
		}
	}
}

func TestConfiguredHTTPServerHasDefensiveTimeouts(t *testing.T) {
	t.Parallel()

	server := configuredHTTPServer(http.NotFoundHandler())
	if server.ReadHeaderTimeout <= 0 || server.ReadTimeout <= 0 || server.WriteTimeout <= 0 || server.IdleTimeout <= 0 {
		t.Fatalf("server timeouts are not all positive: %#v", server)
	}
	if server.MaxHeaderBytes != maxHeaderBytes {
		t.Fatalf("MaxHeaderBytes = %d, want %d", server.MaxHeaderBytes, maxHeaderBytes)
	}
}

func TestServerURLUsesSelectedLANAddressAndPort(t *testing.T) {
	t.Parallel()

	server := &Server{lanIP: net.ParseIP("192.168.1.42"), port: 18_322}
	if got, want := server.URL("token_value"), "http://192.168.1.42:18322/t/token_value"; got != want {
		t.Fatalf("URL() = %q, want %q", got, want)
	}
	if got := server.LANIP(); got.String() != "192.168.1.42" {
		t.Fatalf("LANIP() = %s, want 192.168.1.42", got)
	}
	if server.Port() != 18_322 {
		t.Fatalf("Port() = %d, want 18322", server.Port())
	}
}

type stubAddress string

func (address stubAddress) Network() string { return "tcp" }
func (address stubAddress) String() string  { return string(address) }

type stubListener struct {
	address net.Addr
}

func (listener *stubListener) Accept() (net.Conn, error) { return nil, net.ErrClosed }
func (listener *stubListener) Close() error              { return nil }
func (listener *stubListener) Addr() net.Addr            { return listener.address }
