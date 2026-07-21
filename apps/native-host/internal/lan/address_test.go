package lan

import (
	"errors"
	"net"
	"testing"
)

func TestSelectPrivateIPv4FiltersUnusableAddresses(t *testing.T) {
	t.Parallel()

	candidates := []Candidate{
		{IP: net.ParseIP("127.0.0.1"), InterfaceName: "loopback", Flags: net.FlagUp | net.FlagLoopback},
		{IP: net.ParseIP("169.254.10.2"), InterfaceName: "apipa", Flags: net.FlagUp},
		{IP: net.ParseIP("8.8.8.8"), InterfaceName: "public", Flags: net.FlagUp},
		{IP: net.ParseIP("2001:db8::1"), InterfaceName: "ipv6", Flags: net.FlagUp},
		{IP: net.ParseIP("192.168.1.20"), InterfaceName: "down", Flags: 0},
		{IP: net.ParseIP("172.16.2.3"), InterfaceName: "Ethernet", InterfaceIndex: 8, PrefixBits: 24, Flags: net.FlagUp},
	}

	got, err := SelectPrivateIPv4(candidates)
	if err != nil {
		t.Fatalf("SelectPrivateIPv4() error = %v", err)
	}
	if got.String() != "172.16.2.3" {
		t.Fatalf("SelectPrivateIPv4() = %s, want 172.16.2.3", got)
	}
}

func TestSelectPrivateIPv4PrefersPhysicalLANAdapter(t *testing.T) {
	t.Parallel()

	candidates := []Candidate{
		{IP: net.ParseIP("192.168.56.1"), InterfaceName: "VirtualBox Host-Only", InterfaceIndex: 2, PrefixBits: 24, Flags: net.FlagUp},
		{IP: net.ParseIP("10.8.0.5"), InterfaceName: "Tailscale VPN", InterfaceIndex: 3, PrefixBits: 24, Flags: net.FlagUp | net.FlagPointToPoint},
		{IP: net.ParseIP("192.168.1.42"), InterfaceName: "Wi-Fi", InterfaceIndex: 12, PrefixBits: 24, Flags: net.FlagUp},
	}

	got, err := SelectPrivateIPv4(candidates)
	if err != nil {
		t.Fatalf("SelectPrivateIPv4() error = %v", err)
	}
	if got.String() != "192.168.1.42" {
		t.Fatalf("SelectPrivateIPv4() = %s, want 192.168.1.42", got)
	}
}

func TestSelectPrivateIPv4UsesDeterministicTieBreak(t *testing.T) {
	t.Parallel()

	candidates := []Candidate{
		{IP: net.ParseIP("10.0.0.20"), InterfaceName: "adapter", InterfaceIndex: 5, PrefixBits: 24, Flags: net.FlagUp},
		{IP: net.ParseIP("10.0.0.10"), InterfaceName: "adapter", InterfaceIndex: 5, PrefixBits: 24, Flags: net.FlagUp},
	}

	got, err := SelectPrivateIPv4(candidates)
	if err != nil {
		t.Fatalf("SelectPrivateIPv4() error = %v", err)
	}
	if got.String() != "10.0.0.10" {
		t.Fatalf("SelectPrivateIPv4() = %s, want 10.0.0.10", got)
	}
}

func TestSelectPrivateIPv4ReturnsNoLANAddress(t *testing.T) {
	t.Parallel()

	_, err := SelectPrivateIPv4([]Candidate{{IP: net.ParseIP("203.0.113.10"), Flags: net.FlagUp}})
	if !errors.Is(err, ErrNoLANAddress) {
		t.Fatalf("SelectPrivateIPv4() error = %v, want ErrNoLANAddress", err)
	}
}

func TestAddressIPParsesIPv4Network(t *testing.T) {
	t.Parallel()

	ip, network, err := net.ParseCIDR("192.168.10.4/24")
	if err != nil {
		t.Fatalf("ParseCIDR() error = %v", err)
	}
	network.IP = ip

	gotIP, gotPrefix := addressIP(network)
	if gotIP.String() != "192.168.10.4" || gotPrefix != 24 {
		t.Fatalf("addressIP() = (%s, %d), want (192.168.10.4, 24)", gotIP, gotPrefix)
	}
}
