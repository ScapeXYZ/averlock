package extension

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/gob"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ethereum/go-ethereum/common"
	"io"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const stateEnvelopeVersion = "v1"

type stateStore interface {
	Load(common.Hash) (*policyState, error)
	Save(common.Hash, *policyState) error
}

var errStateMissing = errors.New("durable FCC state missing")

type memoryStore struct{ values map[common.Hash]*policyState }

func newMemoryStore() *memoryStore { return &memoryStore{values: map[common.Hash]*policyState{}} }
func (s *memoryStore) Load(r common.Hash) (*policyState, error) {
	if r == (common.Hash{}) {
		return nil, errors.New("rule ID must be a non-zero bytes32")
	}
	if v := s.values[r]; v != nil {
		return v, nil
	}
	return nil, errStateMissing
}
func (s *memoryStore) Save(r common.Hash, v *policyState) error {
	if r == (common.Hash{}) || v == nil || v.Policy.RuleID != r {
		return errors.New("invalid rule-bound state")
	}
	s.values[r] = v
	return nil
}

type envelope struct {
	Version    string `json:"version"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}
type redisStore struct {
	address, username, password, database, prefix string
	ttls                                          bool
	aead                                          cipher.AEAD
	chainID                                       uint64
	extensionID                                   string
}

func stateStoreFromEnv() stateStore {
	if os.Getenv("FCC_STATE_STORE") == "" || os.Getenv("FCC_STATE_STORE") == "memory" {
		return newMemoryStore()
	}
	if os.Getenv("FCC_STATE_STORE") != "redis" {
		panic("unsupported FCC_STATE_STORE")
	}
	key, err := sealKey(os.Getenv("FCC_STATE_SEAL_KEY"))
	if err != nil {
		panic(err)
	}
	chainID, err := requiredPositiveUint("CHAIN_ID")
	if err != nil {
		panic(err)
	}
	extensionID, err := requiredPositiveUint("EXTENSION_ID")
	if err != nil {
		panic(err)
	}
	r, err := parseRedisURL(os.Getenv("REDIS_URL"))
	if err != nil {
		panic(err)
	}
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	return &redisStore{address: r.Host, username: r.Username, password: r.Password, database: r.Database, ttls: r.TLS, prefix: fmt.Sprintf("averlock:%d:%d", chainID, extensionID), aead: aead, chainID: chainID, extensionID: strconv.FormatUint(extensionID, 10)}
}

func requiredPositiveUint(name string) (uint64, error) {
	v := strings.TrimSpace(os.Getenv(name))
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil || n == 0 {
		return 0, fmt.Errorf("%s must be a positive decimal integer for FCC_STATE_STORE=redis", name)
	}
	return n, nil
}

type redisURL struct {
	Host, Username, Password, Database string
	TLS                                bool
}

func parseRedisURL(raw string) (redisURL, error) {
	u, err := url.Parse(raw)
	if err != nil || u == nil || (u.Scheme != "redis" && u.Scheme != "rediss") || u.Host == "" || u.User == nil || u.RawQuery != "" || u.Fragment != "" {
		return redisURL{}, errors.New("REDIS_URL must be a redis:// or rediss:// URL with credentials and host:port")
	}
	host, port, err := net.SplitHostPort(u.Host)
	if err != nil || host == "" {
		return redisURL{}, errors.New("REDIS_URL must include a valid host:port")
	}
	p, err := strconv.ParseUint(port, 10, 16)
	if err != nil || p == 0 {
		return redisURL{}, errors.New("REDIS_URL port must be 1-65535")
	}
	password, ok := u.User.Password()
	if !ok || password == "" {
		return redisURL{}, errors.New("REDIS_URL must include a password")
	}
	db := strings.TrimPrefix(u.EscapedPath(), "/")
	if db == "" {
		db = "0"
	}
	if strings.Contains(db, "/") {
		return redisURL{}, errors.New("REDIS_URL database must be numeric")
	}
	if _, err := strconv.ParseUint(db, 10, 31); err != nil {
		return redisURL{}, errors.New("REDIS_URL database must be numeric")
	}
	return redisURL{Host: u.Host, Username: u.User.Username(), Password: password, Database: db, TLS: u.Scheme == "rediss"}, nil
}
func sealKey(v string) ([]byte, error) {
	var b []byte
	var err error
	if len(v) == 64 {
		b, err = hex.DecodeString(v)
	} else {
		b, err = base64.StdEncoding.DecodeString(v)
	}
	if err != nil || len(b) != 32 {
		return nil, errors.New("FCC_STATE_SEAL_KEY must be exactly 32 bytes encoded as base64 or 64-char hex")
	}
	return b, nil
}
func (s *redisStore) validRule(r common.Hash) error {
	if r == (common.Hash{}) {
		return errors.New("rule ID must be a non-zero bytes32")
	}
	return nil
}
func (s *redisStore) key(r common.Hash) string {
	if s.validRule(r) != nil {
		return ""
	}
	return s.prefix + ":" + r.Hex() + ":state"
}
func (s *redisStore) aad(r common.Hash) []byte {
	return []byte(fmt.Sprintf("averlock|%d|%s|%s|%s", s.chainID, s.extensionID, r.Hex(), stateEnvelopeVersion))
}
func (s *redisStore) Save(r common.Hash, v *policyState) error {
	if err := s.validRule(r); err != nil {
		return err
	}
	if v == nil || v.Policy.RuleID != r {
		return errors.New("invalid rule-bound state")
	}
	var raw strings.Builder
	if err := gob.NewEncoder(&raw).Encode(v); err != nil {
		return err
	}
	n := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, n); err != nil {
		return err
	}
	e := envelope{stateEnvelopeVersion, base64.StdEncoding.EncodeToString(n), base64.StdEncoding.EncodeToString(s.aead.Seal(nil, n, []byte(raw.String()), s.aad(r)))}
	data, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return s.command("SET", s.key(r), string(data))
}
func (s *redisStore) Load(r common.Hash) (*policyState, error) {
	if err := s.validRule(r); err != nil {
		return nil, err
	}
	out, err := s.get(s.key(r))
	if err != nil {
		return nil, err
	}
	var e envelope
	if json.Unmarshal([]byte(out), &e) != nil || e.Version != stateEnvelopeVersion || e.Nonce == "" || e.Ciphertext == "" {
		return nil, errors.New("invalid durable FCC envelope")
	}
	n, err := base64.StdEncoding.DecodeString(e.Nonce)
	if err != nil || len(n) != s.aead.NonceSize() {
		return nil, errors.New("invalid durable FCC envelope")
	}
	c, err := base64.StdEncoding.DecodeString(e.Ciphertext)
	if err != nil {
		return nil, errors.New("invalid durable FCC envelope")
	}
	p, err := s.aead.Open(nil, n, c, s.aad(r))
	if err != nil {
		return nil, errors.New("durable FCC state authentication failed")
	}
	var v policyState
	if err = gob.NewDecoder(strings.NewReader(string(p))).Decode(&v); err != nil {
		return nil, errors.New("invalid durable FCC state")
	}
	commitment, err := policyCommitment(v.Policy)
	if err != nil || commitment != v.Commitment || v.Policy.RuleID != r {
		return nil, errors.New("durable FCC state binding mismatch")
	}
	return &v, nil
}
func (s *redisStore) command(a ...string) error { _, e := s.do(a...); return e }
func (s *redisStore) get(k string) (string, error) {
	v, e := s.do("GET", k)
	if e != nil {
		return "", e
	}
	if v == "" {
		return "", errStateMissing
	}
	return v, nil
}
func (s *redisStore) do(a ...string) (string, error) {
	var c net.Conn
	var err error
	if s.ttls {
		c, err = tls.Dial("tcp", s.address, redisTLSConfig())
	} else {
		c, err = net.Dial("tcp", s.address)
	}
	if err != nil {
		return "", err
	}
	defer c.Close()
	if s.password != "" {
		args := []string{"AUTH"}
		if s.username != "" {
			args = append(args, s.username)
		}
		args = append(args, s.password)
		if _, err = s.doConn(c, args...); err != nil {
			return "", err
		}
	}
	if s.database != "0" {
		if _, err = s.doConn(c, "SELECT", s.database); err != nil {
			return "", err
		}
	}
	return s.doConn(c, a...)
}

func redisTLSConfig() *tls.Config { return &tls.Config{MinVersion: tls.VersionTLS12} }
func (s *redisStore) doConn(c net.Conn, a ...string) (string, error) {
	if _, err := fmt.Fprintf(c, "*%d\r\n", len(a)); err != nil {
		return "", err
	}
	for _, x := range a {
		if _, err := fmt.Fprintf(c, "$%d\r\n%s\r\n", len(x), x); err != nil {
			return "", err
		}
	}
	r := bufio.NewReader(c)
	line, err := r.ReadString('\n')
	if err != nil || len(line) == 0 {
		return "", err
	}
	switch line[0] {
	case '$':
		var n int
		if _, err := fmt.Sscanf(line, "$%d", &n); err != nil {
			return "", err
		}
		if n < 0 {
			return "", nil
		}
		b := make([]byte, n+2)
		if _, err = io.ReadFull(r, b); err != nil {
			return "", err
		}
		return string(b[:n]), nil
	case '+':
		return "", nil
	case '-':
		return "", errors.New("redis command failed")
	}
	return "", errors.New("invalid redis response")
}
