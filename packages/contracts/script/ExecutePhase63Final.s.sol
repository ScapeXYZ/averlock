// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {GuardManager} from "../src/GuardManager.sol";
import {FCCDecisionCodec} from "../src/FCCDecisionCodec.sol";
import {ProtectionVault} from "../src/ProtectionVault.sol";

/// @notice Atomically approves the exact FTestXRP amount and executes the final prepared guard.
contract ExecutePhase63Final is Script {
    address internal constant OWNER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant MANAGER = 0x444947Aaa00aB3fddbeb6421244A160448E6B52D;
    address internal constant FTEST_XRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    bytes32 internal constant RULE = 0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400;
    bytes32 internal constant EVENT = 0xc4d12008caea289e8809d9f2884522ed85aac29600e43d1f07a566c896514819;
    uint256 internal constant EVENT_VALUE = 1056936000000000000000;
    uint256 internal constant PRICE = 1056936000000000000;
    string internal constant RESULT_ARTIFACT = "../fcc-extension/data/phase63-action-result.local.json";

    function run() external {
        require(block.chainid == 114, "wrong chain");
        require(msg.sender == OWNER, "wrong signer");
        GuardManager manager = GuardManager(MANAGER);
        require(!manager.isEventConsumed(EVENT), "event consumed");
        GuardManager.EvaluationSnapshot memory snapshot = manager.getEvaluationSnapshot(EVENT);
        require(snapshot.ruleId == RULE && snapshot.eventValueUsd18 == EVENT_VALUE, "snapshot value mismatch");
        require(snapshot.priceUsd18 == PRICE, "snapshot price mismatch");

        (GuardManager.FCCActionResult memory result, uint256 exactAmount, uint256 nonce) =
            _loadAndValidateResult(manager, snapshot.priceUsd18);
        require(exactAmount == 700_000_000, "unexpected protected amount");
        IERC20 token = IERC20(FTEST_XRP);
        require(token.balanceOf(OWNER) >= exactAmount, "insufficient FTestXRP");
        ProtectionVault vault = manager.protectionVault();
        uint256 positionsBefore = vault.positionCount();
        uint256 managerBalanceBefore = token.balanceOf(MANAGER);
        require(managerBalanceBefore == 0, "manager has pre-existing token balance");

        vm.startBroadcast();
        token.approve(MANAGER, exactAmount);
        (bool triggered, uint256 positionId, uint256 protectedAmount) = manager.executeGuard(RULE, EVENT, result);
        vm.stopBroadcast();

        require(triggered && protectedAmount == exactAmount, "execution mismatch");
        require(vault.positionCount() == positionsBefore + 1 && positionId == positionsBefore + 1, "position mismatch");
        require(token.balanceOf(MANAGER) == 0, "manager retained FTestXRP");
        require(manager.isEventConsumed(EVENT), "event not consumed");
        require(manager.isResultConsumed(result.actionId), "result not consumed");
        require(manager.isNonceUsed(RULE, nonce), "nonce not consumed");

        console2.logBytes32(result.actionId);
        console2.log("protected FTestXRP units", exactAmount);
        console2.log("vault position ID", positionId);
    }

    function _loadAndValidateResult(GuardManager manager, uint256 price)
        private
        view
        returns (GuardManager.FCCActionResult memory result, uint256 exactAmount, uint256 nonce)
    {
        string memory json = vm.readFile(RESULT_ARTIFACT);
        result = GuardManager.FCCActionResult({
            actionId: vm.parseJsonBytes32(json, ".actionId"),
            submissionTag: vm.parseJsonString(json, ".submissionTag"),
            status: uint8(vm.parseJsonUint(json, ".status")),
            data: vm.parseJsonBytes(json, ".data"),
            signature: vm.parseJsonBytes(json, ".signature")
        });
        // tee-node emits the recovery identifier as 0/1. OpenZeppelin's
        // canonical 65-byte ECDSA decoder requires the equivalent 27/28 form.
        if (result.signature.length == 65 && uint8(result.signature[64]) < 27) {
            result.signature[64] = bytes1(uint8(result.signature[64]) + 27);
        }
        require(result.data.length == FCCDecisionCodec.ENCODED_LENGTH, "invalid decision length");
        FCCDecisionCodec.Decision memory decision = abi.decode(result.data, (FCCDecisionCodec.Decision));
        require(decision.domain == manager.GUARD_RESULT_DOMAIN(), "wrong domain");
        require(decision.ruleId == RULE && decision.eventHash == EVENT, "wrong decision binding");
        require(decision.eventValueUsd18 == EVENT_VALUE && decision.triggered, "wrong decision value");
        require(decision.protectBps == 7000 && decision.scheduleId == 1, "wrong protection terms");
        require(decision.resultExpiry >= block.timestamp, "decision expired");
        require(decision.resultExpiry - decision.evaluatedAt <= 600, "invalid result lifetime");
        require(!manager.isResultConsumed(result.actionId), "result consumed");
        require(!manager.isNonceUsed(RULE, decision.nonce), "nonce consumed");
        exactAmount = Math.mulDiv(decision.protectedUsd18, 1e6, price);
        nonce = decision.nonce;
    }
}
