// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {BaseProtectionVault} from "../../src/base/BaseProtectionVault.sol";
import {BaseGuardManager} from "../../src/base/BaseGuardManager.sol";

/// @notice Deploys AVERLOCK v1 to Base Sepolia. Requires BASE_APPROVED_TOKEN and a Foundry sender.
contract DeployBaseSepolia is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    error WrongChain(uint256 actual);
    error MissingTokenCode(address token);

    function run() external returns (BaseProtectionVault vault, BaseGuardManager manager) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);
        address token = vm.envAddress("BASE_APPROVED_TOKEN");
        if (token.code.length == 0) revert MissingTokenCode(token);
        address[] memory assets = new address[](1);
        assets[0] = token;
        vm.startBroadcast();
        vault = new BaseProtectionVault();
        manager = new BaseGuardManager(address(vault), assets);
        vm.stopBroadcast();
        console2.log("BaseProtectionVault", address(vault));
        console2.log("BaseGuardManager", address(manager));
        console2.log("Approved token", token);
        console2.log("Deployment block", block.number);
    }
}
