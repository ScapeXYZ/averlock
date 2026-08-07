#!/usr/bin/env bash
set -euo pipefail

rpc="https://coston2-api.flare.network/ext/C/rpc"
asset_manager="0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA"
cast_bin="${FOUNDRY_BIN:-$HOME/.foundry/bin/cast}"

for signature in \
  'directMintingPaymentAddress()(string)' \
  'getDirectMintingMinimumFeeUBA()(uint256)' \
  'getDirectMintingFeeBIPS()(uint256)' \
  'getDirectMintingExecutorFeeUBA()(uint256)' \
  'getDirectMintingHourlyLimitUBA()(uint256)' \
  'getDirectMintingDailyLimitUBA()(uint256)' \
  'getDirectMintingLargeMintingThresholdUBA()(uint256)' \
  'getDirectMintingLargeMintingDelaySeconds()(uint256)' \
  'getDirectMintingOthersCanExecuteAfterSeconds()(uint256)'
do
  printf '%s: ' "$signature"
  "$cast_bin" call "$asset_manager" "$signature" --rpc-url "$rpc"
done
