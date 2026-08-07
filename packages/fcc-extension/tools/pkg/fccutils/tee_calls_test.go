package fccutils

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

func resultServer(t *testing.T, pending int, finalStatus int) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var requests atomic.Int32
	id := common.HexToHash("0x1234")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call := int(requests.Add(1))
		if r.Method != http.MethodGet {
			t.Errorf("poller resubmitted with method %s", r.Method)
		}
		if r.URL.Path != "/action/result/"+strings.TrimPrefix(id.Hex(), "0x") {
			t.Errorf("wrong result path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("submissionTag") != "threshold" {
			t.Errorf("missing threshold submission tag")
		}
		if call <= pending {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(finalStatus)
		if finalStatus == http.StatusOK {
			_ = json.NewEncoder(w).Encode(teetypes.ActionResponse{Result: teetypes.ActionResult{ID: id, Status: 1}})
		}
	}))
	return server, &requests
}

func TestActionResultInitial404Then200(t *testing.T) {
	server, requests := resultServer(t, 1, http.StatusOK)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := pollActionResult(ctx, server.Client(), server.URL, common.HexToHash("0x1234"), time.Millisecond)
	if err != nil || result.Result.ID != common.HexToHash("0x1234") || requests.Load() != 2 {
		t.Fatalf("unexpected poll result: result=%+v requests=%d err=%v", result, requests.Load(), err)
	}
}

func TestActionResultMultiplePendingThen200(t *testing.T) {
	server, requests := resultServer(t, 3, http.StatusOK)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := pollActionResult(ctx, server.Client(), server.URL, common.HexToHash("0x1234"), time.Millisecond)
	if err != nil || requests.Load() != 4 {
		t.Fatalf("requests=%d err=%v", requests.Load(), err)
	}
}

func TestActionResultTimeout(t *testing.T) {
	server, _ := resultServer(t, 1_000_000, http.StatusOK)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := pollActionResult(ctx, server.Client(), server.URL, common.HexToHash("0x1234"), time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "timed out waiting for action result") || actionResultTimeout != 120*time.Second {
		t.Fatalf("unexpected timeout: %v", err)
	}
}

func TestActionResultFatal4xx(t *testing.T) {
	server, requests := resultServer(t, 0, http.StatusBadRequest)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := pollActionResult(ctx, server.Client(), server.URL, common.HexToHash("0x1234"), time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "fatal action result HTTP status 400") || requests.Load() != 1 {
		t.Fatalf("requests=%d err=%v", requests.Load(), err)
	}
}

func TestActionResultPollingNeverResubmits(t *testing.T) {
	server, requests := resultServer(t, 2, http.StatusOK)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := pollActionResult(ctx, server.Client(), server.URL, common.HexToHash("0x1234"), time.Millisecond)
	if err != nil || requests.Load() != 3 {
		t.Fatalf("requests=%d err=%v", requests.Load(), err)
	}
}
