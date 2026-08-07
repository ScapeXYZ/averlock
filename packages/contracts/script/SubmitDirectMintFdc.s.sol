// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IFdcHub} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcHub.sol";
import {
    IFdcRequestFeeConfigurations
} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcRequestFeeConfigurations.sol";

/// @notice Submits only the verifier-approved XRPPayment request for the one
///         Phase 6.3E direct-mint payment.
contract SubmitDirectMintFdc is Script {
    string internal constant ARTIFACT = "../fdc-scripts/data/direct-mint-fdc.local.json";
    address internal constant EXPECTED_SIGNER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    bytes32 internal constant EXPECTED_TRANSACTION_ID =
        0x0e16edc43a159df1ca34a02b76f8a9420d7f337cf85b098d44319f7eb21d4e82;

    error WrongChain(uint256 actual);
    error WrongSigner(address actual);
    error InvalidRequest();

    function run() external {
        if (block.chainid != 114) revert WrongChain(block.chainid);
        if (msg.sender != EXPECTED_SIGNER) revert WrongSigner(msg.sender);
        bytes memory request = vm.parseJsonBytes(vm.readFile(ARTIFACT), ".abiEncodedRequest");
        bytes32 transactionId;
        address proofOwner;
        assembly {
            transactionId := mload(add(request, 0x80))
            proofOwner := mload(add(request, 0xa0))
        }
        if (transactionId != EXPECTED_TRANSACTION_ID || proofOwner != EXPECTED_SIGNER) revert InvalidRequest();

        IFdcHub hub = ContractRegistry.getFdcHub();
        IFdcRequestFeeConfigurations fees = ContractRegistry.getFdcRequestFeeConfigurations();
        uint256 requestFee = fees.getRequestFee(request);
        require(address(hub).code.length > 0, "FdcHub has no code");
        require(requestFee <= EXPECTED_SIGNER.balance, "insufficient C2FLR");
        console2.log("FdcHub", address(hub));
        console2.log("proofOwner", proofOwner);
        console2.logBytes32(transactionId);
        console2.log("request fee", requestFee);

        vm.startBroadcast();
        hub.requestAttestation{value: requestFee}(request);
        vm.stopBroadcast();
    }
}
