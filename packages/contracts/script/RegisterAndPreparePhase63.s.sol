// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";

import {GuardManager} from "../src/GuardManager.sol";

/// @notice Registers the accepted private-policy commitment and prepares its exact FDC/FTSO snapshot.
contract RegisterAndPreparePhase63 is Script {
    address internal constant EXPECTED_OWNER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant MANAGER = 0x444947Aaa00aB3fddbeb6421244A160448E6B52D;
    bytes32 internal constant RULE_ID = 0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400;
    bytes32 internal constant POLICY_COMMITMENT = 0xc0233498cec668b66e90044ec8c8844b3693b34d2bb8e6ae82d3af182c36850c;
    bytes32 internal constant RECEIVER_HASH = 0x09315be6d53add03ed87dd25dae59f3b774f74b14f0a2c6637c4d1287cc5173c;
    bytes32 internal constant XRPL_TRANSACTION = 0x276e4d3c2f6b2d0a9d59293e82c4eb4e32003a6eaad6945e95d51a1e2c0e603c;
    uint32 internal constant SCHEDULE_ID = 1;
    string internal constant PROOF_ARTIFACT = "../fdc-scripts/data/phase63-proof.local.json";

    error WrongChain(uint256 actual);
    error WrongOwner(address actual);
    error ProofMismatch();

    function run() external {
        if (block.chainid != 114) revert WrongChain(block.chainid);
        if (msg.sender != EXPECTED_OWNER) revert WrongOwner(msg.sender);

        string memory artifact = vm.readFile(PROOF_ARTIFACT);
        bytes memory responseHex = vm.parseJsonBytes(artifact, ".responseHex");
        bytes32[] memory merkleProof = abi.decode(vm.parseJson(artifact, ".merkleProof"), (bytes32[]));
        IXRPPayment.Response memory response = abi.decode(responseHex, (IXRPPayment.Response));
        IXRPPayment.Proof memory proof = IXRPPayment.Proof({merkleProof: merkleProof, data: response});

        if (
            response.requestBody.transactionId != XRPL_TRANSACTION || response.requestBody.proofOwner != MANAGER
                || response.responseBody.receivingAddressHash != RECEIVER_HASH
                || response.responseBody.receivedAmount != 1_000_000_000 || response.responseBody.status != 0
        ) revert ProofMismatch();

        GuardManager manager = GuardManager(MANAGER);
        require(manager.GUARD_RESULT_DOMAIN() == keccak256("AVERLOCK_GUARD_RESULT_V2"), "not V2 manager");
        require(!manager.isEventConsumed(_eventHash(manager, response)), "event already consumed");

        vm.startBroadcast();
        manager.registerGuard(RULE_ID, POLICY_COMMITMENT, RECEIVER_HASH, SCHEDULE_ID);
        (bytes32 eventHash, uint256 eventValueUsd18, uint256 priceUsd18, uint64 priceTimestamp) =
            manager.prepareGuardEvaluation(RULE_ID, proof);
        vm.stopBroadcast();

        GuardManager.EvaluationSnapshot memory snapshot = manager.getEvaluationSnapshot(eventHash);
        require(snapshot.ruleId == RULE_ID, "snapshot rule mismatch");
        require(snapshot.eventValueUsd18 == eventValueUsd18, "snapshot value mismatch");
        require(snapshot.priceUsd18 == priceUsd18, "snapshot price mismatch");
        require(snapshot.priceTimestamp == priceTimestamp, "snapshot timestamp mismatch");
        require(eventValueUsd18 > 1_000 ether, "payment is not over threshold at snapshot price");

        console2.logBytes32(RULE_ID);
        console2.logBytes32(POLICY_COMMITMENT);
        console2.logBytes32(eventHash);
        console2.log("eventValueUsd18", eventValueUsd18);
        console2.log("priceUsd18", priceUsd18);
        console2.log("priceTimestamp", priceTimestamp);
        console2.log("preparedAt", snapshot.preparedAt);
    }

    function _eventHash(GuardManager manager, IXRPPayment.Response memory response) private view returns (bytes32) {
        return manager.deriveEventHash(
            response.requestBody.transactionId,
            response.responseBody.receivingAddressHash,
            uint256(response.responseBody.receivedAmount),
            response.responseBody.blockTimestamp
        );
    }
}
