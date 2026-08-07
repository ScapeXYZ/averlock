package fccutils

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	csigning "github.com/flare-foundation/go-flare-common/pkg/signing"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/go-flare-common/pkg/tee/attestation/googlecloud"
	"github.com/flare-foundation/tee-node/pkg/attestation"
	"github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

// Live Coston2 instruction results are asynchronous. The pinned tee-proxy
// returns 404 from GET /action/result/{id} while the exact action/tag result is
// absent. Poll only that ID for two minutes; never resubmit the instruction.
const (
	actionResultTimeout  = 120 * time.Second
	actionResultInterval = 2 * time.Second
)

func TeeInfo(nodeURL string) (*types.SignedTeeInfoResponse, error) {
	result, err := http.Get(nodeURL + "/info")
	if err != nil {
		return nil, errors.Errorf("%s", err)
	}
	defer result.Body.Close()

	var teeInfo types.SignedTeeInfoResponse
	err = json.NewDecoder(result.Body).Decode(&teeInfo)
	if err != nil {
		return nil, errors.Errorf("%s", err)
	}

	return &teeInfo, nil
}

func CodeHashAndPlatform(attestationString string) (common.Hash, common.Hash, error) {
	claims := attestation.NeededClaims{}
	_, _, err := googlecloud.ParsePKITokenUnverifiedClaims(attestationString, &claims)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s", err)
	}

	codeHash, err := claims.CodeHash()
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s", err)
	}
	platform, err := claims.Platform()
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s", err)
	}

	return codeHash, platform, nil
}

func TeeProxyId(teeInfo *types.SignedTeeInfoResponse) (common.Address, common.Address, error) {
	pubKey, err := types.ParsePubKey(teeInfo.TeeInfo.PublicKey)
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}

	teeID := crypto.PubkeyToAddress(*pubKey)

	hash, err := teeInfo.TeeInfo.Hash()
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}
	// The proxy signs the TEE info over a domain-separated, chain-ID-bound
	// payload (Payload{ProxyTeeInfo, chainID, infoHash}) — see tee-proxy
	// external.go. Recover the proxy address over the SAME preimage, or the
	// proxyId comes out garbage and the on-chain availability check is rejected
	// by the verifier with "proxy signer does not match".
	infoSignHash, err := csigning.NewPayload(csigning.ProxyTeeInfo, teeInfo.TeeInfo.ChainID, common.BytesToHash(hash)).Hash()
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}
	proxyPubKey, err := crypto.SigToPub(accounts.TextHash(infoSignHash[:]), teeInfo.ProxySignature)
	if err != nil {
		return common.Address{}, common.Address{}, errors.Errorf("%s", err)
	}
	proxyID := crypto.PubkeyToAddress(*proxyPubKey)

	return teeID, proxyID, nil
}

func ActionResult(nodeURL string, actionID common.Hash) (*types.ActionResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), actionResultTimeout)
	defer cancel()
	return pollActionResult(ctx, http.DefaultClient, nodeURL, actionID, actionResultInterval)
}

func pollActionResult(ctx context.Context, client *http.Client, nodeURL string, actionID common.Hash, interval time.Duration) (*types.ActionResponse, error) {
	// submissionTag is explicit so the lookup cannot silently drift if a proxy
	// default changes. On-chain instructions are consumed at threshold.
	url := strings.TrimRight(nodeURL, "/") + "/action/result/" +
		strings.TrimPrefix(actionID.Hex(), "0x") + "?submissionTag=threshold"
	var lastStatus int
	var lastErr error

	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, errors.Errorf("building action result request: %s", err)
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
		} else {
			lastStatus = resp.StatusCode
			switch {
			case resp.StatusCode == http.StatusOK:
				var response types.ActionResponse
				decodeErr := json.NewDecoder(resp.Body).Decode(&response)
				resp.Body.Close()
				if decodeErr != nil {
					return nil, errors.Errorf("decoding action result: %s", decodeErr)
				}
				return &response, nil
			case resp.StatusCode == http.StatusNotFound:
				// Documented pending state: result for this action/tag is not stored yet.
				resp.Body.Close()
			case resp.StatusCode >= 500 && resp.StatusCode <= 599:
				// A transient proxy failure may clear before the overall deadline.
				resp.Body.Close()
			default:
				resp.Body.Close()
				return nil, errors.Errorf("fatal action result HTTP status %d for %s", resp.StatusCode, actionID.Hex())
			}
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			if lastErr != nil {
				return nil, errors.Errorf("timed out waiting for action result %s after %s: last request error: %s",
					actionID.Hex(), actionResultTimeout, lastErr)
			}
			return nil, errors.Errorf("timed out waiting for action result %s after %s: last HTTP status %d",
				actionID.Hex(), actionResultTimeout, lastStatus)
		case <-timer.C:
		}
	}
}

func SetProxyUrl(configurationPort int, proxyPort int) error {
	url := fmt.Sprintf("http://localhost:%d", proxyPort)
	request := types.ConfigureProxyURLRequest{
		URL: &url,
	}

	body, err := json.Marshal(request)
	if err != nil {
		return err
	}

	url = fmt.Sprintf("http://localhost:%d/proxy", configurationPort)
	logger.Infof("Setting proxy url on tee: %s", url)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	return nil
}
