// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title FCCDecisionCodec
/// @notice Canonical fixed-width ABI codec shared with the AVERLOCK Go extension.
library FCCDecisionCodec {
    bytes32 internal constant DOMAIN = keccak256("AVERLOCK_GUARD_RESULT_V2");
    uint256 internal constant ENCODED_LENGTH = 11 * 32;

    struct Decision {
        bytes32 domain;
        bytes32 ruleId;
        bytes32 eventHash;
        bool triggered;
        uint256 protectedUsd18;
        uint16 protectBps;
        uint32 scheduleId;
        uint256 eventValueUsd18;
        uint64 evaluatedAt;
        uint256 nonce;
        uint64 resultExpiry;
    }

    error InvalidDecisionEncodingLength(uint256 actual, uint256 expected);
    error NonCanonicalDecisionEncoding();

    function decode(bytes calldata payload) internal pure returns (Decision memory decision) {
        if (payload.length != ENCODED_LENGTH) {
            revert InvalidDecisionEncodingLength(payload.length, ENCODED_LENGTH);
        }
        decision = abi.decode(payload, (Decision));
        if (keccak256(payload) != keccak256(encode(decision))) revert NonCanonicalDecisionEncoding();
    }

    function encode(Decision memory decision) internal pure returns (bytes memory) {
        return abi.encode(
            decision.domain,
            decision.ruleId,
            decision.eventHash,
            decision.triggered,
            decision.protectedUsd18,
            decision.protectBps,
            decision.scheduleId,
            decision.eventValueUsd18,
            decision.evaluatedAt,
            decision.nonce,
            decision.resultExpiry
        );
    }

    function resultHash(Decision memory decision, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                decision.domain,
                chainId,
                decision.ruleId,
                decision.eventHash,
                decision.triggered,
                decision.protectedUsd18,
                decision.protectBps,
                decision.scheduleId,
                decision.eventValueUsd18,
                decision.evaluatedAt,
                decision.nonce,
                decision.resultExpiry
            )
        );
    }
}
