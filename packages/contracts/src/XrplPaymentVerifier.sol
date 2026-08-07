// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";
import {IXRPPaymentVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentVerification.sol";

/// @title XrplPaymentVerifier
/// @notice Narrow adapter around Flare's official XRPPayment proof verifier.
contract XrplPaymentVerifier {
    bytes32 public constant XRP_PAYMENT_ATTESTATION_TYPE = bytes32("XRPPayment");

    struct PaymentData {
        bytes32 transactionId;
        bytes32 receivingAddressHash;
        uint256 receivedDrops;
        uint64 blockTimestamp;
    }

    IXRPPaymentVerification public immutable fdcVerification;
    bytes32 public immutable expectedSourceId;

    error InvalidFdcVerifier();
    error InvalidSourceId();
    error InvalidXRPPaymentProof();
    error InvalidProofOwner(address proofOwner, address caller);
    error PaymentFailed(uint8 status);
    error InvalidReceivedAmount(int256 amount);
    error ZeroReceivingAddressHash();

    constructor(address fdcVerificationAddress, bytes32 sourceId) {
        if (fdcVerificationAddress == address(0)) revert InvalidFdcVerifier();
        if (sourceId == bytes32(0)) revert InvalidSourceId();
        fdcVerification = IXRPPaymentVerification(fdcVerificationAddress);
        expectedSourceId = sourceId;
    }

    /// @notice Verifies an official proof and returns only fields AVERLOCK consumes.
    function verifyPayment(IXRPPayment.Proof calldata proof) external view returns (PaymentData memory payment) {
        if (proof.data.attestationType != XRP_PAYMENT_ATTESTATION_TYPE || proof.data.sourceId != expectedSourceId) {
            revert InvalidXRPPaymentProof();
        }
        address proofOwner = proof.data.requestBody.proofOwner;
        if (proofOwner != address(0) && proofOwner != msg.sender) {
            revert InvalidProofOwner(proofOwner, msg.sender);
        }
        if (!fdcVerification.verifyXRPPayment(proof)) revert InvalidXRPPaymentProof();

        IXRPPayment.ResponseBody calldata response = proof.data.responseBody;
        if (response.status != 0) revert PaymentFailed(response.status);
        if (response.receivingAddressHash == bytes32(0)) revert ZeroReceivingAddressHash();
        if (response.receivedAmount <= 0) revert InvalidReceivedAmount(response.receivedAmount);

        payment = PaymentData({
            transactionId: proof.data.requestBody.transactionId,
            receivingAddressHash: response.receivingAddressHash,
            receivedDrops: uint256(response.receivedAmount),
            blockTimestamp: response.blockTimestamp
        });
    }
}
