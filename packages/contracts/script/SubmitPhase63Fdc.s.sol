// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IFdcHub} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcHub.sol";
import {
    IFdcRequestFeeConfigurations
} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcRequestFeeConfigurations.sol";

/// @notice Submits only the verifier-approved Phase 6.3E XRPPayment request.
contract SubmitPhase63Fdc is Script {
    address internal constant EXPECTED_SIGNER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant EXPECTED_PROOF_OWNER = 0x444947Aaa00aB3fddbeb6421244A160448E6B52D;
    bytes32 internal constant EXPECTED_TRANSACTION_ID =
        0x276e4d3c2f6b2d0a9d59293e82c4eb4e32003a6eaad6945e95d51a1e2c0e603c;
    bytes internal constant REQUEST =
        hex"5852505061796d656e74000000000000000000000000000000000000000000007465737458525000000000000000000000000000000000000000000000000000477ddd719e666f2cfd79845f5385b90b2a606a434df813046b3d0c11e33f30a4276e4d3c2f6b2d0a9d59293e82c4eb4e32003a6eaad6945e95d51a1e2c0e603c000000000000000000000000444947aaa00ab3fddbeb6421244a160448e6b52d";

    error WrongChain(uint256 actual);
    error WrongSigner(address actual);
    error InvalidRequest();

    function run() external {
        if (block.chainid != 114) revert WrongChain(block.chainid);
        if (msg.sender != EXPECTED_SIGNER) revert WrongSigner(msg.sender);
        bytes memory request = REQUEST;

        // Fail closed if the verifier-approved fixed request is accidentally changed.
        bytes32 transactionId;
        address proofOwner;
        assembly {
            transactionId := mload(add(request, 0x80))
            proofOwner := mload(add(request, 0xa0))
        }
        if (transactionId != EXPECTED_TRANSACTION_ID || proofOwner != EXPECTED_PROOF_OWNER) revert InvalidRequest();

        IFdcHub hub = ContractRegistry.getFdcHub();
        IFdcRequestFeeConfigurations fees = ContractRegistry.getFdcRequestFeeConfigurations();
        uint256 requestFee = fees.getRequestFee(request);
        require(address(hub).code.length > 0, "FdcHub has no code");
        require(requestFee <= EXPECTED_SIGNER.balance, "insufficient C2FLR for request fee");

        console2.log("FdcHub", address(hub));
        console2.log("proofOwner", EXPECTED_PROOF_OWNER);
        console2.logBytes32(EXPECTED_TRANSACTION_ID);
        console2.log("request fee", requestFee);
        console2.logBytes(request);

        vm.startBroadcast();
        hub.requestAttestation{value: requestFee}(request);
        vm.stopBroadcast();
    }
}
