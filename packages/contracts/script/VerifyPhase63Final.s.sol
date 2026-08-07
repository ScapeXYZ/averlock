// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GuardManager} from "../src/GuardManager.sol";
import {FCCDecisionCodec} from "../src/FCCDecisionCodec.sol";
import {ProtectionVault} from "../src/ProtectionVault.sol";

/// @notice Read-only postcondition and replay verification for the Phase 6.3 execution.
contract VerifyPhase63Final is Script {
    address internal constant OWNER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant MANAGER = 0x444947Aaa00aB3fddbeb6421244A160448E6B52D;
    address internal constant FTEST_XRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    bytes32 internal constant RULE = 0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400;
    bytes32 internal constant EVENT = 0xc4d12008caea289e8809d9f2884522ed85aac29600e43d1f07a566c896514819;
    uint256 internal constant EXACT_AMOUNT = 700_000_000;
    string internal constant RESULT_ARTIFACT = "../fcc-extension/data/phase63-action-result.local.json";

    function run() external view {
        require(block.chainid == 114, "wrong chain");
        GuardManager manager = GuardManager(MANAGER);
        IERC20 token = IERC20(FTEST_XRP);
        ProtectionVault vault = manager.protectionVault();
        string memory json = vm.readFile(RESULT_ARTIFACT);
        bytes32 actionId = vm.parseJsonBytes32(json, ".actionId");
        bytes memory data = vm.parseJsonBytes(json, ".data");
        FCCDecisionCodec.Decision memory decision = abi.decode(data, (FCCDecisionCodec.Decision));
        uint256 nonce = decision.nonce;

        require(manager.isEventConsumed(EVENT), "event not consumed");
        require(manager.isResultConsumed(actionId), "result not consumed");
        require(manager.isNonceUsed(RULE, nonce), "nonce not consumed");
        require(token.balanceOf(MANAGER) == 0, "manager retained FTestXRP");
        require(token.allowance(OWNER, MANAGER) == 0, "unexpected remaining allowance");

        uint256 positionId = vault.positionCount();
        require(positionId > 0, "position missing");
        ProtectionVault.Position memory position = vault.getPosition(positionId);
        require(position.asset == FTEST_XRP && position.beneficiary == OWNER, "position parties mismatch");
        require(position.totalDeposited == EXACT_AMOUNT && position.claimed == 0, "position principal mismatch");
        require(position.endTimestamp - position.startTimestamp == 30 days, "position schedule mismatch");
        require(token.balanceOf(address(vault)) >= EXACT_AMOUNT, "vault token balance mismatch");

        GuardManager.FCCActionResult memory result = GuardManager.FCCActionResult({
            actionId: actionId,
            submissionTag: vm.parseJsonString(json, ".submissionTag"),
            status: uint8(vm.parseJsonUint(json, ".status")),
            data: data,
            signature: vm.parseJsonBytes(json, ".signature")
        });
        if (result.signature.length == 65 && uint8(result.signature[64]) < 27) {
            result.signature[64] = bytes1(uint8(result.signature[64]) + 27);
        }
        (bool replaySucceeded,) =
            address(manager).staticcall(abi.encodeCall(GuardManager.executeGuard, (RULE, EVENT, result)));
        require(!replaySucceeded, "replay unexpectedly succeeded");

        console2.log("PHASE63_BACKEND_COMPLETE");
        console2.log("vault position ID", positionId);
        console2.log("protected FTestXRP units", position.totalDeposited);
        console2.log("owner FTestXRP balance", token.balanceOf(OWNER));
        console2.log("vault FTestXRP balance", token.balanceOf(address(vault)));
        console2.log("GuardManager FTestXRP balance", token.balanceOf(MANAGER));
        console2.log("replay rejected", true);
    }
}
