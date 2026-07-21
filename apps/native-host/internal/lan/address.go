// Package lan discovers a stable RFC1918 IPv4 address for BookBridge URLs.
package lan

import (
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
)

var ErrNoLANAddress = errors.New("NO_LAN_ADDRESS")

// Candidate is an IPv4 address associated with a local network interface.
// It is exported so selection can be tested without a real network.
type Candidate struct {
	IP             net.IP
	InterfaceName  string
	InterfaceIndex int
	PrefixBits     int
	Flags          net.Flags
}

// DiscoverPrivateIPv4 enumerates active interfaces and selects an RFC1918
// address. Loopback, link-local, multicast, unspecified, and IPv6 addresses are
// excluded.
func DiscoverPrivateIPv4() (net.IP, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("enumerate network interfaces: %w", err)
	}

	var candidates []Candidate
	for _, networkInterface := range interfaces {
		if networkInterface.Flags&net.FlagUp == 0 || networkInterface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, addressErr := networkInterface.Addrs()
		if addressErr != nil {
			continue
		}
		for _, address := range addresses {
			ip, prefixBits := addressIP(address)
			if ip == nil {
				continue
			}
			candidates = append(candidates, Candidate{
				IP:             ip,
				InterfaceName:  networkInterface.Name,
				InterfaceIndex: networkInterface.Index,
				PrefixBits:     prefixBits,
				Flags:          networkInterface.Flags,
			})
		}
	}

	return SelectPrivateIPv4(candidates)
}

// SelectPrivateIPv4 filters and deterministically ranks candidate addresses.
// Physical Wi-Fi/Ethernet-style interfaces and specific subnet prefixes are
// preferred, while virtual adapters remain available as a fallback.
func SelectPrivateIPv4(candidates []Candidate) (net.IP, error) {
	eligible := make([]Candidate, 0, len(candidates))
	for _, candidate := range candidates {
		ipv4 := candidate.IP.To4()
		if ipv4 == nil || !isRFC1918(ipv4) || !usable(candidate) {
			continue
		}
		candidate.IP = append(net.IP(nil), ipv4...)
		eligible = append(eligible, candidate)
	}
	if len(eligible) == 0 {
		return nil, ErrNoLANAddress
	}

	sort.SliceStable(eligible, func(left, right int) bool {
		leftScore := candidateScore(eligible[left])
		rightScore := candidateScore(eligible[right])
		if leftScore != rightScore {
			return leftScore > rightScore
		}
		if eligible[left].InterfaceIndex != eligible[right].InterfaceIndex {
			return eligible[left].InterfaceIndex < eligible[right].InterfaceIndex
		}
		return bytesLess(eligible[left].IP, eligible[right].IP)
	})

	return append(net.IP(nil), eligible[0].IP...), nil
}

func addressIP(address net.Addr) (net.IP, int) {
	switch value := address.(type) {
	case *net.IPNet:
		ones, bits := value.Mask.Size()
		if bits != 32 {
			return nil, 0
		}
		return value.IP.To4(), ones
	case *net.IPAddr:
		return value.IP.To4(), 0
	default:
		ip, network, err := net.ParseCIDR(address.String())
		if err != nil || ip.To4() == nil {
			return nil, 0
		}
		ones, bits := network.Mask.Size()
		if bits != 32 {
			return nil, 0
		}
		return ip.To4(), ones
	}
}

func usable(candidate Candidate) bool {
	ip := candidate.IP
	if candidate.Flags&net.FlagUp == 0 || candidate.Flags&net.FlagLoopback != 0 {
		return false
	}
	return !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified() && !ip.IsMulticast()
}

func isRFC1918(ip net.IP) bool {
	ipv4 := ip.To4()
	if ipv4 == nil {
		return false
	}
	return ipv4[0] == 10 ||
		(ipv4[0] == 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
		(ipv4[0] == 192 && ipv4[1] == 168)
}

func candidateScore(candidate Candidate) int {
	score := 0
	name := strings.ToLower(candidate.InterfaceName)
	if !looksVirtual(name) {
		score += 100
	}
	if strings.Contains(name, "wi-fi") || strings.Contains(name, "wifi") || strings.Contains(name, "wlan") || strings.Contains(name, "ethernet") {
		score += 20
	}
	if candidate.Flags&net.FlagPointToPoint == 0 {
		score += 10
	}
	if candidate.PrefixBits >= 16 && candidate.PrefixBits <= 30 {
		score += candidate.PrefixBits
	}
	if candidate.IP[0] == 192 && candidate.IP[1] == 168 {
		score += 4
	} else if candidate.IP[0] == 172 {
		score += 2
	}
	return score
}

func looksVirtual(name string) bool {
	virtualMarkers := []string{"virtual", "vethernet", "hyper-v", "vmware", "docker", "wsl", "tailscale", "zerotier", "loopback"}
	for _, marker := range virtualMarkers {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return false
}

func bytesLess(left, right net.IP) bool {
	for index := range left {
		if left[index] != right[index] {
			return left[index] < right[index]
		}
	}
	return false
}
