// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {GuardManager} from "../src/GuardManager.sol";
import {IFlareTeeManager} from "../src/interfaces/IFlareTeeManager.sol";

/// @notice Deploys only the registry-backed GuardManager replacement on Coston2.
contract DeployGuardManagerRegistry is Script {
    address internal constant DEPLOYER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant VAULT = 0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb;
    address internal constant PRICE_READER = 0xf2F2bf463b0765729189DeBe4E22dCEd601A18d5;
    address internal constant PAYMENT_VERIFIER = 0x10B2419e526Dc860E85c2315536389FA0D1269DA;
    address internal constant FTEST_XRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    address internal constant TEE_MANAGER = 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE;
    address internal constant CURRENT_TEE = 0xb90bd9dBDc25e210CCD1C2764a09b23b993Eb311;
    address internal constant TEE_PROXY = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    string internal constant TEE_URL = "https://crescentoid-earless-kelsi.ngrok-free.dev";
    uint256 internal constant EXTENSION_ID = 65927;
    uint64 internal constant MAX_PRICE_AGE = 300;

    function run() external returns (GuardManager manager) {
        require(block.chainid == 114, "wrong chain");
        require(msg.sender == DEPLOYER, "wrong deployer");
        require(VAULT.code.length > 0 && PRICE_READER.code.length > 0, "missing shared dependency");
        require(PAYMENT_VERIFIER.code.length > 0 && FTEST_XRP.code.length > 0, "missing shared dependency");
        require(TEE_MANAGER.code.length > 0, "missing TEE manager");

        IFlareTeeManager registry = IFlareTeeManager(TEE_MANAGER);
        IFlareTeeManager.TeeMachine memory machine = registry.getTeeMachine(CURRENT_TEE);
        require(machine.teeId == CURRENT_TEE, "current TEE unregistered");
        require(machine.teeProxyId == TEE_PROXY, "wrong TEE proxy");
        require(keccak256(bytes(machine.url)) == keccak256(bytes(TEE_URL)), "wrong TEE URL");
        require(registry.getExtensionId(CURRENT_TEE) == EXTENSION_ID, "wrong extension");
        require(registry.getTeeMachineStatus(CURRENT_TEE) == 2, "TEE not PRODUCTION");

        console2.log("deployer", DEPLOYER);
        console2.log("balance", DEPLOYER.balance);
        console2.log("current production TEE", CURRENT_TEE);
        console2.log("extension ID", EXTENSION_ID);

        vm.startBroadcast();
        manager = new GuardManager(
            VAULT,
            PAYMENT_VERIFIER,
            PRICE_READER,
            FTEST_XRP,
            TEE_MANAGER,
            EXTENSION_ID,
            TEE_PROXY,
            keccak256(bytes(TEE_URL)),
            MAX_PRICE_AGE
        );
        vm.stopBroadcast();

        require(address(manager.protectionVault()) == VAULT, "vault mismatch");
        require(address(manager.paymentVerifier()) == PAYMENT_VERIFIER, "verifier mismatch");
        require(address(manager.priceReader()) == PRICE_READER, "reader mismatch");
        require(address(manager.fxrp()) == FTEST_XRP, "token mismatch");
        require(address(manager.teeManager()) == TEE_MANAGER, "registry mismatch");
        require(manager.extensionId() == EXTENSION_ID, "extension mismatch");
        require(manager.expectedTeeProxy() == TEE_PROXY, "proxy mismatch");
        require(manager.expectedTeeUrlHash() == keccak256(bytes(TEE_URL)), "URL mismatch");
        require(manager.maxPriceAge() == MAX_PRICE_AGE, "price age mismatch");
        require(manager.GUARD_RESULT_DOMAIN() == keccak256("AVERLOCK_GUARD_RESULT_V2"), "domain mismatch");
        console2.log("RegistryBackedGuardManager", address(manager));
    }
}
