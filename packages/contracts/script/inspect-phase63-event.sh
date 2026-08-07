#!/usr/bin/env bash
set -euo pipefail
cast_bin="${FOUNDRY_BIN:-$HOME/.foundry/bin/cast}"
rpc="https://coston2-api.flare.network/ext/C/rpc"
manager="0x3e93537EbB9a389D33943Cb4D2911bEC1f69E872"
event="0xc4d12008caea289e8809d9f2884522ed85aac29600e43d1f07a566c896514819"
"$cast_bin" call "$manager" 'getEvaluationSnapshot(bytes32)((bytes32,uint256,uint256,uint64,uint64,uint64))' "$event" --rpc-url "$rpc"
"$cast_bin" call "$manager" 'isEventConsumed(bytes32)(bool)' "$event" --rpc-url "$rpc"
