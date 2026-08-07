// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ITeeExtensionRegistry} from "./interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "./interfaces/ITeeMachineRegistry.sol";

/// @title AverlockInstructionSender
/// @notice Minimal transport between callers and the AVERLOCK_GUARD FCC extension.
/// @dev Policy payloads must be encrypted to the selected TEE before submission.
///      This contract never decodes or emits private policy terms.
contract AverlockInstructionSender {
    // Each ASCII identifier below is shorter than 32 bytes, so conversion cannot truncate it.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_AVERLOCK_GUARD = bytes32("AVERLOCK_GUARD");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_CREATE_POLICY = bytes32("CREATE_POLICY");
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_EVALUATE_GUARD = bytes32("EVALUATE_GUARD");

    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;

    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000;
    uint256 private _extensionId;

    constructor(ITeeExtensionRegistry _teeExtensionRegistry, ITeeMachineRegistry _teeMachineRegistry) {
        require(address(_teeExtensionRegistry) != address(0), "TeeExtensionRegistry cannot be zero address");
        require(address(_teeMachineRegistry) != address(0), "TeeMachineRegistry cannot be zero address");
        require(address(_teeExtensionRegistry).code.length > 0, "TeeExtensionRegistry has no code");
        require(address(_teeMachineRegistry).code.length > 0, "TeeMachineRegistry has no code");
        TEE_EXTENSION_REGISTRY = _teeExtensionRegistry;
        TEE_MACHINE_REGISTRY = _teeMachineRegistry;
    }

    function setExtensionId() external {
        require(_extensionId == 0, "Extension ID already set.");
        uint256 count = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < count; ++i) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                return;
            }
        }
        revert("Extension ID not found.");
    }

    /// @param encryptedPolicyEnvelope JSON envelope containing only opaque ciphertext encrypted to the target TEE.
    function createPolicy(bytes calldata encryptedPolicyEnvelope) external payable {
        require(encryptedPolicyEnvelope.length > 0, "Encrypted policy cannot be empty");
        _send(OP_COMMAND_CREATE_POLICY, encryptedPolicyEnvelope);
    }

    /// @param evaluationContext Public evaluation context encoded for the extension.
    function evaluateGuard(bytes calldata evaluationContext) external payable {
        require(evaluationContext.length > 0, "Evaluation context cannot be empty");
        _send(OP_COMMAND_EVALUATE_GUARD, evaluationContext);
    }

    function _send(bytes32 command, bytes calldata message) private {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_AVERLOCK_GUARD,
            opCommand: command,
            message: message,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });
        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }

    function _getExtensionId() internal view returns (uint256) {
        require(_extensionId != 0, "Extension ID is not set.");
        return _extensionId;
    }
}
