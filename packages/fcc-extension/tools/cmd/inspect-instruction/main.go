package main

import (
	"context"
	"flag"
	"fmt"
	"math/big"
	"os"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/flare-foundation/go-flare-common/pkg/contracts/tee/verification"
)

const eventSignature = "TeeInstructionsSent(uint256,bytes32,uint32,(address,address,string)[],bytes32,bytes32,bytes,address[],uint64,address,uint256)"

func main() {
	rpc := flag.String("rpc", "https://coston2-api.flare.network/ext/C/rpc", "Coston2 RPC")
	managerText := flag.String("manager", "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE", "FlareTeeManager")
	actionText := flag.String("action", "", "instruction/action ID")
	lookback := flag.Uint64("lookback", 10000, "blocks to inspect")
	flag.Parse()
	if !common.IsHexAddress(*managerText) || len(*actionText) != 66 {
		fatal("valid -manager and bytes32 -action are required")
	}
	client, err := ethclient.Dial(*rpc)
	if err != nil {
		fatal("connect RPC: %v", err)
	}
	defer client.Close()
	ctx := context.Background()
	latest, err := client.BlockNumber(ctx)
	if err != nil {
		fatal("read latest block: %v", err)
	}
	start := uint64(0)
	if latest > *lookback {
		start = latest - *lookback
	}
	manager := common.HexToAddress(*managerText)
	binding, err := verification.NewVerification(manager, client)
	if err != nil {
		fatal("bind FlareTeeManager: %v", err)
	}
	action := common.HexToHash(*actionText)
	topic0 := crypto.Keccak256Hash([]byte(eventSignature))
	for from := start; from <= latest; from += 30 {
		to := from + 29
		if to > latest {
			to = latest
		}
		logs, filterErr := client.FilterLogs(ctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(from), ToBlock: new(big.Int).SetUint64(to),
			Addresses: []common.Address{manager}, Topics: [][]common.Hash{{topic0}, nil, {action}},
		})
		if filterErr != nil {
			fatal("filter blocks %d-%d: %v", from, to, filterErr)
		}
		for _, entry := range logs {
			if len(entry.Topics) < 4 {
				continue
			}
			fmt.Printf("INSTRUCTION_ONCHAIN tx=%s block=%d extensionId=%s actionId=%s signingPolicy=%s\n",
				entry.TxHash, entry.BlockNumber, entry.Topics[1].Big(), entry.Topics[2], entry.Topics[3].Big())
			decoded, parseErr := binding.ParseTeeInstructionsSent(entry)
			if parseErr != nil {
				fatal("decode instruction: %v", parseErr)
			}
			for _, machine := range decoded.TeeMachines {
				fmt.Printf("TARGET_TEE tee=%s proxy=%s url=%s\n", machine.TeeId, machine.TeeProxyId, machine.Url)
			}
			fmt.Printf("OP type=%q command=%q cosigners=%d threshold=%d\n",
				stringTrim(decoded.OpType[:]), stringTrim(decoded.OpCommand[:]), len(decoded.Cosigners), decoded.CosignersThreshold)
			return
		}
	}
	fmt.Printf("INSTRUCTION_NOT_FOUND actionId=%s blocks=%d-%d\n", action, start, latest)
}

func stringTrim(value []byte) string {
	end := len(value)
	for end > 0 && value[end-1] == 0 {
		end--
	}
	return string(value[:end])
}

func fatal(format string, values ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", values...)
	os.Exit(1)
}
