package extension

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type PolicyDecryptor interface {
	Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error)
}

type teeNodeDecryptor struct {
	url    string
	client *http.Client
}

func newTEENodeDecryptor(signPort int) PolicyDecryptor {
	return &teeNodeDecryptor{
		url:    fmt.Sprintf("http://localhost:%d/decrypt", signPort),
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (d *teeNodeDecryptor) Decrypt(ctx context.Context, ciphertext []byte) ([]byte, error) {
	body, err := json.Marshal(struct {
		EncryptedMessage []byte `json:"encryptedMessage"`
	}{EncryptedMessage: ciphertext})
	if err != nil {
		return nil, fmt.Errorf("encoding decrypt request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating decrypt request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling tee-node decrypt API: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("tee-node decrypt API returned %s: %s", resp.Status, message)
	}
	var decoded struct {
		DecryptedMessage []byte `json:"decryptedMessage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decoding decrypt response: %w", err)
	}
	if len(decoded.DecryptedMessage) == 0 {
		return nil, fmt.Errorf("tee-node returned empty plaintext")
	}
	return decoded.DecryptedMessage, nil
}
