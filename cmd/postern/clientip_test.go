package main

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

// withTrusted trusts the given proxies for one test.
func withTrusted(t *testing.T, spec string) {
	t.Helper()
	p, err := parseTrustedProxies(spec)
	if err != nil {
		t.Fatal(err)
	}
	prev := trustedProxies
	trustedProxies = p
	t.Cleanup(func() { trustedProxies = prev })
}

func fromPeer(peer string, headers ...string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = peer
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Add(headers[i], headers[i+1])
	}
	return req
}

func TestParseTrustedProxies(t *testing.T) {
	got, err := parseTrustedProxies(" 10.0.0.5, 172.18.0.0/16  fd00::1\t192.168.1.9/24 ")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"10.0.0.5/32", "172.18.0.0/16", "fd00::1/128", "192.168.1.0/24"}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i, w := range want {
		if got[i].String() != w {
			t.Errorf("entry %d = %s, want %s", i, got[i], w)
		}
	}

	if got, err := parseTrustedProxies(""); err != nil || len(got) != 0 {
		t.Fatalf("empty list: %v %v", got, err)
	}
	if got, err := parseTrustedProxies("private"); err != nil || len(got) != len(privateProxyRanges) {
		t.Fatalf("private keyword: %v %v", got, err)
	}
	// An IPv4-mapped address is read as the IPv4 address it stands for.
	if got, err := parseTrustedProxies("::ffff:10.0.0.5"); err != nil || got[0].String() != "10.0.0.5/32" {
		t.Fatalf("mapped address: %v %v", got, err)
	}

	for _, bad := range []string{"nope", "10.0.0.5/99", "10.0.0.0/8, banana", "0.0.0.0/0", "::/0", "1.2.3.4:80"} {
		if _, err := parseTrustedProxies(bad); err == nil {
			t.Errorf("%q was accepted", bad)
		} else if !strings.Contains(err.Error(), trustedProxiesEnv) {
			t.Errorf("%q: error %q does not name the variable", bad, err)
		}
	}
}

func TestClientIPIgnoresHeadersByDefault(t *testing.T) {
	// Nothing trusted: the headers are only a caller's claim.
	req := fromPeer("203.0.113.9:1111", "X-Forwarded-For", "1.2.3.4", "X-Real-IP", "5.6.7.8")
	if got := clientIP(req); got != "203.0.113.9" {
		t.Fatalf("clientIP = %q", got)
	}
}

func TestClientIPBehindTrustedProxy(t *testing.T) {
	withTrusted(t, "10.0.0.1, 10.0.0.2")
	cases := []struct {
		name string
		req  *http.Request
		want string
	}{
		{"client from X-Forwarded-For", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "198.51.100.7"), "198.51.100.7"},
		{"no header: the proxy itself", fromPeer("10.0.0.1:5000"), "10.0.0.1"},
		{"X-Real-IP when there is no X-Forwarded-For", fromPeer("10.0.0.1:5000", "X-Real-IP", "198.51.100.8"), "198.51.100.8"},
		{"X-Forwarded-For wins over X-Real-IP", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "198.51.100.7", "X-Real-IP", "198.51.100.8"), "198.51.100.7"},
		{"a chain of trusted proxies is skipped", fromPeer("10.0.0.2:5000", "X-Forwarded-For", "198.51.100.7, 10.0.0.1"), "198.51.100.7"},
		{"entries the caller wrote on the left are not believed", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "6.6.6.6, 198.51.100.7"), "198.51.100.7"},
		{"a spoofed trusted address on the left does not help", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "10.0.0.2, 198.51.100.7"), "198.51.100.7"},
		{"several header lines are one list", func() *http.Request {
			return fromPeer("10.0.0.1:5000", "X-Forwarded-For", "6.6.6.6", "X-Forwarded-For", "198.51.100.7")
		}(), "198.51.100.7"},
		{"port on the forwarded address", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "198.51.100.7:4433"), "198.51.100.7"},
		{"IPv6 client", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "2001:db8::7"), "2001:db8::7"},
		{"bracketed IPv6 with a port", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "[2001:db8::7]:4433"), "2001:db8::7"},
		{"IPv4-mapped client", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "::ffff:198.51.100.7"), "198.51.100.7"},
		{"garbage entry: fall back to the proxy", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "unknown"), "10.0.0.1"},
		{"garbage left of a good entry is ignored", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "unknown, 198.51.100.7"), "198.51.100.7"},
		{"garbage right of the chain: nothing to believe", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "198.51.100.7, unknown"), "10.0.0.1"},
		{"every hop trusted: the leftmost is the client", fromPeer("10.0.0.1:5000", "X-Forwarded-For", "10.0.0.2"), "10.0.0.2"},
		// The peer is not a trusted proxy, so its headers are only claims.
		{"untrusted peer is never believed", fromPeer("203.0.113.9:1111", "X-Forwarded-For", "198.51.100.7"), "203.0.113.9"},
		{"untrusted peer, X-Real-IP", fromPeer("203.0.113.9:1111", "X-Real-IP", "198.51.100.7"), "203.0.113.9"},
	}
	for _, c := range cases {
		if got := clientIP(c.req); got != c.want {
			t.Errorf("%s: clientIP = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestClientIPWithIPv6AndMappedPeers(t *testing.T) {
	withTrusted(t, "10.0.0.1, fd00::1")
	if got := clientIP(fromPeer("[fd00::1]:5000", "X-Forwarded-For", "198.51.100.7")); got != "198.51.100.7" {
		t.Fatalf("IPv6 proxy: %q", got)
	}
	if got := clientIP(fromPeer("[::ffff:10.0.0.1]:5000", "X-Forwarded-For", "198.51.100.7")); got != "198.51.100.7" {
		t.Fatalf("IPv4-mapped proxy address: %q", got)
	}
	if got := clientIP(fromPeer("[fe80::1%eth0]:5000", "X-Forwarded-For", "198.51.100.7")); got != "fe80::1%eth0" {
		t.Fatalf("zoned untrusted peer: %q", got)
	}
}

func TestPrivateKeywordTrustsLANAndTreatsLANClientsAsClients(t *testing.T) {
	withTrusted(t, "private")
	// A proxy on the Docker network, a real client on the internet.
	if got := clientIP(fromPeer("172.18.0.3:5000", "X-Forwarded-For", "198.51.100.7")); got != "198.51.100.7" {
		t.Fatalf("docker proxy: %q", got)
	}
	// A machine on the LAN going through the same proxy: its own address is the client.
	if got := clientIP(fromPeer("172.18.0.3:5000", "X-Forwarded-For", "192.168.1.50")); got != "192.168.1.50" {
		t.Fatalf("LAN client: %q", got)
	}
	// A public address is not a trusted proxy.
	if got := clientIP(fromPeer("198.51.100.20:5000", "X-Forwarded-For", "1.2.3.4")); got != "198.51.100.20" {
		t.Fatalf("public peer: %q", got)
	}
}

func TestTrustedProxyAddrContains(t *testing.T) {
	withTrusted(t, "10.0.0.0/8")
	if !isTrustedProxy(netip.MustParseAddr("10.9.9.9")) || isTrustedProxy(netip.MustParseAddr("11.0.0.1")) {
		t.Fatal("range matching is wrong")
	}
	if !isTrustedProxy(netip.MustParseAddr("::ffff:10.9.9.9")) {
		t.Fatal("a mapped address must match its IPv4 range")
	}
}

// The point of the whole change: callers behind a proxy no longer share one bucket.
func TestRateLimitIsPerRealClientBehindAProxy(t *testing.T) {
	withTrusted(t, "10.0.0.1")
	lim := newProxyLimiter(2)

	asClient := func(ip string) string {
		return clientIP(fromPeer("10.0.0.1:5000", "X-Forwarded-For", ip))
	}
	a, b := asClient("198.51.100.1"), asClient("198.51.100.2")
	if a == b {
		t.Fatal("two clients behind one proxy got the same address")
	}
	for i := 0; i < 2; i++ {
		if !lim.allow("svc", a) {
			t.Fatal("first client refused early")
		}
	}
	if lim.allow("svc", a) {
		t.Fatal("first client was not limited")
	}
	if !lim.allow("svc", b) {
		t.Fatal("second client was limited by the first one's traffic")
	}
}

func TestLimiterReportsFirstRefusalOncePerWindow(t *testing.T) {
	lim := newProxyLimiter(2)
	for i := 0; i < 2; i++ {
		if ok, first := lim.check("svc", "1.1.1.1"); !ok || first {
			t.Fatalf("request %d: ok=%v first=%v", i, ok, first)
		}
	}
	if ok, first := lim.check("svc", "1.1.1.1"); ok || !first {
		t.Fatalf("first refusal: ok=%v first=%v", ok, first)
	}
	for i := 0; i < 3; i++ {
		if ok, first := lim.check("svc", "1.1.1.1"); ok || first {
			t.Fatalf("later refusal %d: ok=%v first=%v", i, ok, first)
		}
	}
	// Another client has its own window, and its own first refusal.
	lim.check("svc", "2.2.2.2")
	lim.check("svc", "2.2.2.2")
	if ok, first := lim.check("svc", "2.2.2.2"); ok || !first {
		t.Fatalf("second client: ok=%v first=%v", ok, first)
	}
	if lim.limit() != 2 {
		t.Fatalf("limit() = %d", lim.limit())
	}
	var off *proxyLimiter
	if off.limit() != 0 {
		t.Fatal("a nil limiter has no limit")
	}
}

func TestLoginLockoutAppliesToTheRealClient(t *testing.T) {
	withTrusted(t, "10.0.0.1")
	l := newLoginLimiter()
	attacker := clientIP(fromPeer("10.0.0.1:5000", "X-Forwarded-For", "198.51.100.66"))
	friend := clientIP(fromPeer("10.0.0.1:5000", "X-Forwarded-For", "198.51.100.5"))
	for i := 0; i < loginMaxFails; i++ {
		l.failure(attacker)
	}
	if !l.blocked(attacker) {
		t.Fatal("the attacker was not locked out")
	}
	if l.blocked(friend) {
		t.Fatal("someone else behind the same proxy was locked out")
	}
}
