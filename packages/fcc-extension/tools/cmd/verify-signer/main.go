// Command verify-signer performs password-authorized, read-only signer
// initialization. It never creates, signs, or broadcasts a transaction.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"extension-scaffold/tools/pkg/signer"

	"github.com/ethereum/go-ethereum/ethclient"
)

func main() {
	rpcURL := flag.String("c", "https://coston2-api.flare.network/ext/C/rpc", "chain RPC URL")
	flag.Parse()

	client, err := ethclient.Dial(*rpcURL)
	if err != nil { fail(err) }
	defer client.Close()
	chainID, err := client.ChainID(context.Background())
	if err != nil { fail(err) }
	key, address, err := signer.LoadFromEnvironment(chainID)
	if err != nil { fail(err) }
	defer signer.ZeroPrivateKey(key)
	fmt.Printf("Verified encrypted signer: address=%s chain_id=%s\n", address.Hex(), chainID.String())
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "Signer verification failed: %v\n", err)
	os.Exit(1)
}
