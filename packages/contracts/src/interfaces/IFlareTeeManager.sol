// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal interface for the live FlareTeeManager machine registry.
interface IFlareTeeManager {
    struct TeeMachine {
        address teeId;
        address teeProxyId;
        string url;
    }

    function getTeeMachine(address teeId) external view returns (TeeMachine memory);
    function getTeeMachineStatus(address teeId) external view returns (uint8);
    function getExtensionId(address teeId) external view returns (uint256);
}
