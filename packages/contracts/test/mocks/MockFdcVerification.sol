// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";
import {IXRPPaymentVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPaymentVerification.sol";

/// @notice TEST-ONLY deterministic stand-in for the official Coston2 verifier.
contract MockFdcVerification is IXRPPaymentVerification {
    bool public valid = true;

    function setValid(bool value) external {
        valid = value;
    }

    function verifyXRPPayment(IXRPPayment.Proof calldata) external view returns (bool) {
        return valid;
    }
}
