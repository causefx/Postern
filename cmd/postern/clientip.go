package main

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// trustedProxiesEnv lists the reverse proxies whose forwarded headers Postern believes.
const trustedProxiesEnv = "POSTERN_TRUSTED_PROXIES"

// trustedProxies is set once at start-up. Empty means nothing is trusted: the client is always the
// address of the connection, and X-Forwarded-For and X-Real-IP are ignored. Anyone can send those
// headers, so they only count when the connection itself comes from one of these proxies.
var trustedProxies []netip.Prefix

// privateProxyRanges is what the keyword "private" expands to: loopback, RFC 1918 and IPv6 unique
// local addresses. It is a convenience for a proxy on the same host or the same Docker network.
var privateProxyRanges = []string{"127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"}

// parseTrustedProxies reads a comma or space separated list of IP addresses, CIDR ranges, and the
// keyword "private". An empty list is fine and trusts nothing. A range that covers every address is
// refused: it would let any caller choose the address Postern sees.
func parseTrustedProxies(spec string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, tok := range strings.FieldsFunc(spec, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' }) {
		if strings.EqualFold(tok, "private") {
			for _, cidr := range privateProxyRanges {
				out = append(out, netip.MustParsePrefix(cidr))
			}
			continue
		}
		var p netip.Prefix
		if strings.Contains(tok, "/") {
			parsed, err := netip.ParsePrefix(tok)
			if err != nil {
				return nil, fmt.Errorf("%s: %q is not an IP address or CIDR range", trustedProxiesEnv, tok)
			}
			p = netip.PrefixFrom(parsed.Addr().Unmap(), unmappedBits(parsed)).Masked()
		} else {
			addr, err := netip.ParseAddr(tok)
			if err != nil {
				return nil, fmt.Errorf("%s: %q is not an IP address or CIDR range", trustedProxiesEnv, tok)
			}
			addr = addr.Unmap()
			p = netip.PrefixFrom(addr, addr.BitLen())
		}
		if p.Bits() == 0 {
			return nil, fmt.Errorf("%s: %q trusts every address; list your proxy's address instead", trustedProxiesEnv, tok)
		}
		out = append(out, p)
	}
	return out, nil
}

// unmappedBits is the prefix length of p once an IPv4-mapped IPv6 address is read as plain IPv4.
func unmappedBits(p netip.Prefix) int {
	if p.Addr().Is4In6() && p.Bits() >= 96 {
		return p.Bits() - 96
	}
	return p.Bits()
}

func isTrustedProxy(ip netip.Addr) bool {
	ip = ip.Unmap()
	for _, p := range trustedProxies {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// clientIP is the address to rate limit, lock out and log for a request. It is the connection's
// address unless that connection comes from a trusted proxy, in which case it is the client the
// proxy reports.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if len(trustedProxies) == 0 {
		return host
	}
	peer, err := netip.ParseAddr(stripZone(host))
	if err != nil || !isTrustedProxy(peer) {
		return host
	}
	if ip, ok := forwardedClient(r); ok {
		return ip.String()
	}
	return host
}

// forwardedClient picks the client out of the headers a trusted proxy added. X-Forwarded-For lists
// the client first and each proxy that handled the request after it, so the entries a caller wrote
// themselves are on the left and the ones a trusted proxy appended are on the right. Reading from
// the right and skipping trusted proxies stops at the first address a trusted proxy actually saw.
func forwardedClient(r *http.Request) (netip.Addr, bool) {
	if values := r.Header.Values("X-Forwarded-For"); len(values) > 0 {
		hops := strings.Split(strings.Join(values, ","), ",")
		var first netip.Addr
		for i := len(hops) - 1; i >= 0; i-- {
			ip, ok := parseHop(hops[i])
			if !ok {
				// An entry that is not an address cannot be explained, so nothing left of it is
				// believed either.
				return netip.Addr{}, false
			}
			if !isTrustedProxy(ip) {
				return ip, true
			}
			first = ip
		}
		// Every hop was a trusted proxy address, so the leftmost one is the client itself, for
		// example a machine on the same network as the proxy.
		if first.IsValid() {
			return first, true
		}
	}
	if ip, ok := parseHop(r.Header.Get("X-Real-IP")); ok {
		return ip, true
	}
	return netip.Addr{}, false
}

// parseHop reads one forwarded address, with or without a port.
func parseHop(s string) (netip.Addr, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return netip.Addr{}, false
	}
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return ap.Addr().Unmap(), true
	}
	ip, err := netip.ParseAddr(strings.Trim(stripZone(s), "[]"))
	if err != nil {
		return netip.Addr{}, false
	}
	return ip.Unmap(), true
}

func stripZone(s string) string {
	if i := strings.IndexByte(s, '%'); i >= 0 {
		return s[:i]
	}
	return s
}
