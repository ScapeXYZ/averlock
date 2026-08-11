package main

import "testing"

func TestSafeProxyURL(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want string
	}{
		{"empty", "", "<empty>"},
		{"redacts credentials and query", "http://user:password@proxy.railway.internal:6663/path?token=secret#fragment", "http://proxy.railway.internal:6663/path"},
		{"invalid", "://bad", "<invalid>"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := safeProxyURL(tc.raw); got != tc.want {
				t.Fatalf("safeProxyURL(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestEnvValue(t *testing.T) {
	if got := envValue([]string{"OTHER=value", "PROXY_URL=http://proxy:6663"}, "PROXY_URL"); got != "http://proxy:6663" {
		t.Fatalf("envValue returned %q", got)
	}
	if got := envValue([]string{"OTHER=value"}, "PROXY_URL"); got != "" {
		t.Fatalf("envValue missing value = %q", got)
	}
}
