package teenode

import (
	"strings"
	"testing"
)

func TestExtensionIDBytes32Deterministic(t *testing.T) {
	const want = "0x0000000000000000000000000000000000000000000000000000000000010187"
	for i := 0; i < 2; i++ {
		got, err := ExtensionIDBytes32("65927")
		if err != nil || got != want {
			t.Fatalf("conversion = %q, %v; want %q", got, err, want)
		}
	}
}

func TestChildEnvScopesExtensionIDToTeeNode(t *testing.T) {
	env, err := ChildEnv([]string{"EXTENSION_ID=65927", "FCC_STATE_STORE=redis", "PROXY_URL=http://chic-essence.railway.internal:6663", "OTHER=value"}, "65927")
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(env, "\n")
	if !strings.Contains(got, "EXTENSION_ID=0x0000000000000000000000000000000000000000000000000000000000010187") {
		t.Fatalf("tee-node environment lacks padded EXTENSION_ID: %q", got)
	}
	if strings.Contains(got, "EXTENSION_ID=65927") {
		t.Fatalf("tee-node environment retained decimal EXTENSION_ID: %q", got)
	}
	if !strings.Contains(got, "FCC_STATE_STORE=redis") {
		t.Fatal("child environment unexpectedly changed state-store configuration")
	}
	if !strings.Contains(got, "PROXY_URL=http://chic-essence.railway.internal:6663") {
		t.Fatal("child environment unexpectedly changed PROXY_URL")
	}
}

func TestExtensionIDBytes32RejectsInvalidDecimal(t *testing.T) {
	for _, raw := range []string{"", "0", "-1", "0x10187", "65927.0", "abc", strings.Repeat("9", 79)} {
		if _, err := ExtensionIDBytes32(raw); err == nil || !strings.Contains(err.Error(), "EXTENSION_ID") {
			t.Errorf("invalid value %q returned %v", raw, err)
		}
	}
}
