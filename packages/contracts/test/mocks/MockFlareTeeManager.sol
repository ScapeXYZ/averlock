// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFlareTeeManager} from "../../src/interfaces/IFlareTeeManager.sol";

/// @notice TEST-ONLY stand-in for FlareTeeManager registry checks.
contract MockFlareTeeManager is IFlareTeeManager {
    mapping(address => TeeMachine) private machines;
    mapping(address => uint8) private statuses;
    mapping(address => uint256) private extensions;

    function setMachine(address tee, address proxy, string calldata url, uint256 extensionId, uint8 status) external {
        machines[tee] = TeeMachine(tee, proxy, url);
        extensions[tee] = extensionId;
        statuses[tee] = status;
    }

    function getTeeMachine(address tee) external view returns (TeeMachine memory) {
        return machines[tee];
    }

    function getTeeMachineStatus(address tee) external view returns (uint8) {
        return statuses[tee];
    }

    function getExtensionId(address tee) external view returns (uint256) {
        return extensions[tee];
    }
}
