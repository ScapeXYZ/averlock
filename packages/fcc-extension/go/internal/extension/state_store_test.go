package extension

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"net"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

const realRuleID = "0x58fb549f06329f6f899684687f21ce46a091c51ea27b045b05d4bf10b7dc5a0f"

func TestRedisURLParsing(t *testing.T) {
	for _, tc := range []struct {
		raw, user, password, db string
		tls                     bool
	}{
		{"redis://default:PASSWORD@HOST:6379", "default", "PASSWORD", "0", false},
		{"redis://:PASSWORD@HOST:6379", "", "PASSWORD", "0", false},
		{"redis://default:PASSWORD@HOST:6379/0", "default", "PASSWORD", "0", false},
		{"rediss://default:PASSWORD@HOST:6379", "default", "PASSWORD", "0", true},
		{"rediss://default:PASSWORD@HOST:6379/0", "default", "PASSWORD", "0", true},
		{"redis://us%40er:p%40ss%3Aword@HOST:6379/2", "us@er", "p@ss:word", "2", false},
	} {
		got, err := parseRedisURL(tc.raw)
		if err != nil || got.Username != tc.user || got.Password != tc.password || got.Database != tc.db || got.TLS != tc.tls {
			t.Fatalf("parse %q: %#v %v", tc.raw, got, err)
		}
	}
	for _, raw := range []string{"", "http://host:1", "redis://default:pw@", "redis://default:pw@host", "redis://default:pw@host:0", "redis://default:pw@host:99999", "redis://default:pw@host:1/no", "redis://default@host:1", "redis://default:pw@host:1/1/2"} {
		if _, err := parseRedisURL(raw); err == nil {
			t.Errorf("accepted malformed URL %q", raw)
		}
	}
}

func TestRedisTLSConfigurationRequiresTLS12OrHigher(t *testing.T) {
	if config := redisTLSConfig(); config.MinVersion < tls.VersionTLS12 {
		t.Fatal("rediss TLS configuration permits pre-TLS-1.2")
	}
}

func TestSealKeyValidation(t *testing.T) {
	validHex := strings.Repeat("ab", 32)
	validB64 := base64.StdEncoding.EncodeToString(make([]byte, 32))
	for _, raw := range []string{validHex, validB64} {
		if key, err := sealKey(raw); err != nil || len(key) != 32 {
			t.Fatalf("valid key rejected: %v", err)
		}
	}
	for _, raw := range []string{"abc", strings.Repeat("a", 63), strings.Repeat("a", 65), strings.Repeat("z", 64), base64.StdEncoding.EncodeToString(make([]byte, 31)), base64.StdEncoding.EncodeToString(make([]byte, 33))} {
		if _, err := sealKey(raw); err == nil {
			t.Errorf("accepted invalid seal key")
		}
	}
}

func TestRedisStateStartupRequiresValidChainAndExtensionID(t *testing.T) {
	for _, tc := range []struct{ chain, extension string }{{"", "65927"}, {"0", "65927"}, {"114", ""}, {"114", "zero"}} {
		t.Run(tc.chain+":"+tc.extension, func(t *testing.T) {
			t.Setenv("FCC_STATE_STORE", "redis")
			t.Setenv("FCC_STATE_SEAL_KEY", strings.Repeat("11", 32))
			t.Setenv("REDIS_URL", "redis://default:password@127.0.0.1:6379/0")
			t.Setenv("CHAIN_ID", tc.chain)
			t.Setenv("EXTENSION_ID", tc.extension)
			defer func() {
				if recover() == nil {
					t.Fatal("invalid Redis startup configuration accepted")
				}
			}()
			_ = stateStoreFromEnv()
		})
	}
}

func TestRedisNamespaceAndAAD(t *testing.T) {
	b, _ := aes.NewCipher(make([]byte, 32))
	a, _ := cipher.NewGCM(b)
	s := &redisStore{prefix: "averlock:114:65927", chainID: 114, extensionID: "65927", aead: a}
	r := common.HexToHash(realRuleID)
	if got := s.key(r); got != "averlock:114:65927:"+realRuleID+":state" {
		t.Fatalf("wrong key %q", got)
	}
	if s.key(common.Hash{}) != "" {
		t.Fatal("zero rule generated a Redis key")
	}
	c := s.aead.Seal(nil, make([]byte, a.NonceSize()), []byte("x"), s.aad(r))
	if _, err := s.aead.Open(nil, make([]byte, a.NonceSize()), c, s.aad(common.HexToHash("0x02"))); err == nil {
		t.Fatal("cross-rule AAD accepted")
	}
	otherExtension := *s
	otherExtension.extensionID = "65928"
	if _, err := otherExtension.aead.Open(nil, make([]byte, a.NonceSize()), c, otherExtension.aad(r)); err == nil {
		t.Fatal("cross-extension AAD accepted")
	}
	otherChain := *s
	otherChain.chainID = 115
	if _, err := otherChain.aead.Open(nil, make([]byte, a.NonceSize()), c, otherChain.aad(r)); err == nil {
		t.Fatal("cross-chain AAD accepted")
	}
}

func TestRedisStateIntegration(t *testing.T) {
	address, stop := startRedis(t)
	defer stop()
	key := strings.Repeat("11", 32)
	rule := common.HexToHash(realRuleID)
	store := integrationStore(t, address, key, "2")
	state := integrationState(t, rule)
	state.LastTriggered = 123
	state.UsedNonces[7] = struct{}{}
	event := common.HexToHash("0xbeef")
	state.Authorizations[event] = &eventAuthorization{EventValueUSD18: mustBigInt(oneThousandUSD18), Triggered: true, ProtectedUSD18: mustBigInt(fiveHundredUSD18), ProtectBPS: 7000, ScheduleID: 1, LastExpiry: 456}
	if err := store.Save(rule, state); err != nil {
		t.Fatal(err)
	}
	raw, err := store.get(store.key(rule))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, oneThousandUSD18) || strings.Contains(raw, "7000") {
		t.Fatal("Redis value exposes policy plaintext")
	}
	// A new instance must recover the complete newest encrypted state from TCP Redis.
	restarted := integrationStore(t, address, key, "2")
	loaded, err := restarted.Load(rule)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Commitment != state.Commitment || loaded.LastTriggered != 123 || len(loaded.UsedNonces) != 1 || loaded.Authorizations[event].LastExpiry != 456 {
		t.Fatal("restart did not recover policy/cooldown/replay/authorization state")
	}
	loaded.LastTriggered = 999
	loaded.UsedNonces[8] = struct{}{}
	if err := restarted.Save(rule, loaded); err != nil {
		t.Fatal(err)
	}
	newest, err := integrationStore(t, address, key, "2").Load(rule)
	if err != nil || newest.LastTriggered != 999 || len(newest.UsedNonces) != 2 {
		t.Fatalf("newest state was not recovered: %v", err)
	}
	if _, err := integrationStore(t, address, strings.Repeat("22", 32), "2").Load(rule); err == nil {
		t.Fatal("wrong seal key accepted")
	}
	if err := restarted.command("SET", restarted.key(rule), `{"version":"v1","nonce":"bad","ciphertext":"bad"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Load(rule); err == nil {
		t.Fatal("malformed envelope accepted")
	}
	if err := restarted.Save(rule, state); err != nil {
		t.Fatal(err)
	}
	raw, _ = restarted.get(restarted.key(rule))
	if err := restarted.command("SET", restarted.key(common.HexToHash("0x99")), raw); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Load(common.HexToHash("0x99")); err == nil {
		t.Fatal("cross-rule ciphertext accepted")
	}
	if _, err := integrationStore(t, address, key, "0").Load(rule); err == nil {
		t.Fatal("wrong database unexpectedly contained state")
	}
	if _, err := restarted.Load(common.HexToHash("0x1234")); err != errStateMissing {
		t.Fatalf("missing key did not fail closed: %v", err)
	}
	if _, err := restarted.Load(common.Hash{}); err == nil {
		t.Fatal("zero rule accepted")
	}
	if err := restarted.command("SET", restarted.key(rule), `{"version":"v999","nonce":"x","ciphertext":"y"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Load(rule); err == nil {
		t.Fatal("unsupported envelope accepted")
	}
}

func TestRedisUnavailableFailsWithoutMemoryFallback(t *testing.T) {
	s := integrationStore(t, "127.0.0.1:1", strings.Repeat("11", 32), "0")
	if err := s.Save(common.HexToHash(realRuleID), integrationState(t, common.HexToHash(realRuleID))); err == nil {
		t.Fatal("Redis outage was acknowledged")
	}
}

func integrationStore(t *testing.T, address, key, db string) *redisStore {
	t.Helper()
	block, _ := aes.NewCipher(mustSeal(t, key))
	aead, _ := cipher.NewGCM(block)
	return &redisStore{address: address, username: "default", password: "integration-password", database: db, prefix: "averlock:114:65927", chainID: 114, extensionID: "65927", aead: aead}
}
func mustSeal(t *testing.T, raw string) []byte {
	t.Helper()
	b, err := sealKey(raw)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func integrationState(t *testing.T, rule common.Hash) *policyState {
	t.Helper()
	policy, err := normalizePolicy(policyFixture())
	if err != nil {
		t.Fatal(err)
	}
	policy.RuleID = rule
	commitment, err := policyCommitment(policy)
	if err != nil {
		t.Fatal(err)
	}
	return &policyState{Policy: policy, Commitment: commitment, Authorizations: map[common.Hash]*eventAuthorization{}, UsedNonces: map[uint64]struct{}{}}
}

// Docker Redis is a real network Redis server. It is used only in tests; no
// application container starts Redis in Railway production.
func startRedis(t *testing.T) (string, func()) {
	t.Helper()
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker unavailable for real Redis integration test")
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := l.Addr().String()
	_ = l.Close()
	cmd := exec.Command("docker", "run", "-d", "--rm", "-p", address+":6379", "redis:7-alpine", "redis-server", "--requirepass", "integration-password")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("start real Redis: %v: %s", err, out)
	}
	id := strings.TrimSpace(string(out))
	deadline := time.Now().Add(10 * time.Second)
	for {
		probe := &redisStore{address: address, username: "default", password: "integration-password", database: "0"}
		if err := probe.command("PING"); err == nil {
			break
		}
		if time.Now().After(deadline) {
			_ = exec.Command("docker", "rm", "-f", id).Run()
			t.Fatal("timed out waiting for real Redis")
		}
		time.Sleep(50 * time.Millisecond)
	}
	return address, func() { _ = exec.Command("docker", "rm", "-f", id).Run() }
}

func Example() {
	fmt.Println("averlock:114:65927:" + realRuleID + ":state") /* Output: averlock:114:65927:0x58fb549f06329f6f899684687f21ce46a091c51ea27b045b05d4bf10b7dc5a0f:state */
}
