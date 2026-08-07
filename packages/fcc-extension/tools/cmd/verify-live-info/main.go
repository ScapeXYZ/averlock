package main

import (
	"flag"
	"fmt"
	"os"

	"extension-scaffold/tools/pkg/fccutils"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

func main() {
	proxy := flag.String("proxy", "http://127.0.0.1:6674", "extension proxy URL")
	expected := flag.String("tee", "", "expected TEE address")
	flag.Parse()
	info, err := fccutils.TeeInfo(*proxy)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	pub, err := teetypes.ParsePubKey(info.MachineData.PublicKey)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	derived := crypto.PubkeyToAddress(*pub)
	if info.TeeInfo.ChainID != 114 || !common.IsHexAddress(*expected) || derived != common.HexToAddress(*expected) {
		fmt.Fprintf(os.Stderr, "live info mismatch: tee=%s chain=%d\n", derived.Hex(), info.TeeInfo.ChainID)
		os.Exit(1)
	}
	fmt.Printf("LIVE_INFO_VERIFIED tee=%s chainId=%d\n", derived.Hex(), info.TeeInfo.ChainID)
}
