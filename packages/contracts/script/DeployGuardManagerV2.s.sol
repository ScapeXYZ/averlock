// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IAssetManager} from "@flarenetwork/flare-periphery-contracts/coston2/IAssetManager.sol";

import {GuardManager} from "../src/GuardManager.sol";
import {ProtectionVault} from "../src/ProtectionVault.sol";
import {XrpUsdPriceReader} from "../src/XrpUsdPriceReader.sol";
import {XrplPaymentVerifier} from "../src/XrplPaymentVerifier.sol";
import {IFlareTeeManager} from "../src/interfaces/IFlareTeeManager.sol";

/// @notice Deploys only the Phase 6.3 GuardManager V2 replacement on Coston2.
/// @dev Reuses the existing vault, reader, and verifier. It never deploys or mutates them.
contract DeployGuardManagerV2 is Script {
    address internal constant EXPECTED_DEPLOYER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant VAULT = 0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb;
    address internal constant PRICE_READER = 0xf2F2bf463b0765729189DeBe4E22dCEd601A18d5;
    address internal constant PAYMENT_VERIFIER = 0x10B2419e526Dc860E85c2315536389FA0D1269DA;
    address internal constant FTEST_XRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    // This identity and URL are deliberately checked immediately before
    // broadcasting.  GuardManager binds the URL hash immutably, so deploying
    // against an unregistered or differently-addressed TEE is unrecoverable.
    address internal constant TEE_MANAGER = 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE;
    address internal constant TEE_PROXY = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    uint256 internal constant EXTENSION_ID = 65927;

    address internal constant EXPECTED_FDC_VERIFICATION = 0x906507E0B64bcD494Db73bd0459d1C667e14B933;
    address internal constant EXPECTED_FTSO_V2 = 0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d;
    address internal constant EXPECTED_ASSET_MANAGER_FXRP = 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA;
    bytes32 internal constant TEST_XRP_SOURCE_ID = bytes32("testXRP");
    bytes32 internal constant V2_RESULT_DOMAIN = keccak256("AVERLOCK_GUARD_RESULT_V2");
    uint64 internal constant MAX_PRICE_AGE = 300;
    uint256 internal constant MINIMUM_DEPLOYER_BALANCE = 5 ether;

    error WrongChain(uint256 actual);
    error WrongDeployer(address actual);
    error MissingDependencyCode(address dependency);
    error DependencyMismatch(bytes32 dependency, address actual, address expected);
    error SourceIdMismatch(bytes32 actual);
    error InsufficientDeploymentBalance(uint256 actual, uint256 required);
    error TeeRegistrationMismatch(bytes32 field);

    function run() external returns (GuardManager guardManager) {
        if (block.chainid != 114) revert WrongChain(block.chainid);
        if (msg.sender != EXPECTED_DEPLOYER) revert WrongDeployer(msg.sender);

        _requireCode(VAULT);
        _requireCode(PRICE_READER);
        _requireCode(PAYMENT_VERIFIER);
        _requireCode(FTEST_XRP);
        _requireCode(TEE_MANAGER);

        // Both values are mandatory: binding an immutable manager to a stale
        // TEE identity or temporary URL would be unrecoverable.
        address tee = vm.envAddress("GUARD_MANAGER_TEE_ID");
        string memory teeUrl = vm.envString("GUARD_MANAGER_TEE_URL");
        bytes32 teeUrlHash = keccak256(bytes(teeUrl));
        IFlareTeeManager.TeeMachine memory machine = IFlareTeeManager(TEE_MANAGER).getTeeMachine(tee);
        if (machine.teeId != tee) revert TeeRegistrationMismatch("teeId");
        if (machine.teeProxyId != TEE_PROXY) revert TeeRegistrationMismatch("teeProxyId");
        if (keccak256(bytes(machine.url)) != teeUrlHash) revert TeeRegistrationMismatch("url");
        if (IFlareTeeManager(TEE_MANAGER).getExtensionId(tee) != EXTENSION_ID) {
            revert TeeRegistrationMismatch("extensionId");
        }
        if (IFlareTeeManager(TEE_MANAGER).getTeeMachineStatus(tee) != 2) {
            revert TeeRegistrationMismatch("status");
        }

        _requireAddress("FdcVerification", address(ContractRegistry.getFdcVerification()), EXPECTED_FDC_VERIFICATION);
        _requireAddress("FtsoV2", address(ContractRegistry.getTestFtsoV2()), EXPECTED_FTSO_V2);
        address assetManager = address(ContractRegistry.getAssetManagerFXRP());
        _requireAddress("AssetManagerFXRP", assetManager, EXPECTED_ASSET_MANAGER_FXRP);
        _requireAddress("FTestXRP", address(IAssetManager(assetManager).fAsset()), FTEST_XRP);

        XrplPaymentVerifier verifier = XrplPaymentVerifier(PAYMENT_VERIFIER);
        _requireAddress("VerifierFDC", address(verifier.fdcVerification()), EXPECTED_FDC_VERIFICATION);
        bytes32 sourceId = verifier.expectedSourceId();
        if (sourceId != TEST_XRP_SOURCE_ID) revert SourceIdMismatch(sourceId);

        (uint256 priceUsd18, uint64 priceTimestamp) = XrpUsdPriceReader(PRICE_READER).getXrpUsdPriceUsd18();
        require(priceUsd18 != 0, "XRP/USD price is zero");

        uint256 estimatedGas = vm.envOr("GUARD_MANAGER_V2_ESTIMATED_GAS", uint256(3_200_000));
        uint256 requiredBalance = estimatedGas * tx.gasprice;
        if (requiredBalance < MINIMUM_DEPLOYER_BALANCE) requiredBalance = MINIMUM_DEPLOYER_BALANCE;
        if (EXPECTED_DEPLOYER.balance < requiredBalance) {
            revert InsufficientDeploymentBalance(EXPECTED_DEPLOYER.balance, requiredBalance);
        }

        console2.log("deployer", EXPECTED_DEPLOYER);
        console2.log("deployer balance", EXPECTED_DEPLOYER.balance);
        console2.log("estimated deployment gas", estimatedGas);
        console2.log("required balance at current gas price", requiredBalance);
        console2.log("existing ProtectionVault", VAULT);
        console2.log("existing XrpUsdPriceReader", PRICE_READER);
        console2.log("existing XrplPaymentVerifier", PAYMENT_VERIFIER);
        console2.log("FTestXRP", FTEST_XRP);
        console2.log("production TEE", tee);
        console2.log("TEE URL", teeUrl);
        console2.logBytes32(teeUrlHash);
        console2.log("XRP/USD priceUsd18", priceUsd18);
        console2.log("XRP/USD timestamp", priceTimestamp);

        vm.startBroadcast();
        guardManager = new GuardManager(
            VAULT,
            PAYMENT_VERIFIER,
            PRICE_READER,
            FTEST_XRP,
            TEE_MANAGER,
            EXTENSION_ID,
            TEE_PROXY,
            teeUrlHash,
            MAX_PRICE_AGE
        );
        vm.stopBroadcast();

        require(address(guardManager.protectionVault()) == VAULT, "vault wiring mismatch");
        require(address(guardManager.paymentVerifier()) == PAYMENT_VERIFIER, "verifier wiring mismatch");
        require(address(guardManager.priceReader()) == PRICE_READER, "reader wiring mismatch");
        require(address(guardManager.fxrp()) == FTEST_XRP, "FTestXRP wiring mismatch");
        require(guardManager.fxrpDecimals() == 6, "FTestXRP decimals mismatch");
        require(address(guardManager.teeManager()) == TEE_MANAGER, "TEE manager wiring mismatch");
        require(guardManager.extensionId() == EXTENSION_ID, "extension wiring mismatch");
        require(guardManager.expectedTeeProxy() == TEE_PROXY, "TEE proxy wiring mismatch");
        require(guardManager.expectedTeeUrlHash() == teeUrlHash, "TEE URL wiring mismatch");
        require(guardManager.maxPriceAge() == MAX_PRICE_AGE, "price age wiring mismatch");
        require(guardManager.COSTON2_CHAIN_ID() == 114, "chain constant mismatch");
        require(guardManager.GUARD_RESULT_DOMAIN() == V2_RESULT_DOMAIN, "V2 domain mismatch");

        console2.log("GuardManagerV2", address(guardManager));
    }

    function _requireCode(address dependency) private view {
        if (dependency.code.length == 0) revert MissingDependencyCode(dependency);
    }

    function _requireAddress(bytes32 dependency, address actual, address expected) private pure {
        if (actual != expected) revert DependencyMismatch(dependency, actual, expected);
    }
}
