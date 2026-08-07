// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IAssetManager} from "@flarenetwork/flare-periphery-contracts/coston2/IAssetManager.sol";

import {ProtectionVault} from "../src/ProtectionVault.sol";
import {XrpUsdPriceReader} from "../src/XrpUsdPriceReader.sol";
import {XrplPaymentVerifier} from "../src/XrplPaymentVerifier.sol";
import {GuardManager} from "../src/GuardManager.sol";

/// @notice Resumes the partially completed Phase 6.2 deployment by deploying only GuardManager.
/// @dev The three dependency addresses are receipt-backed Coston2 deployments. This script fails
///      closed if the chain, sender, registry dependencies, deployed dependency state, or balance
///      differs from the audited configuration.
contract DeployGuardManager is Script {
    address internal constant EXPECTED_DEPLOYER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant VAULT = 0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb;
    address internal constant PRICE_READER = 0xf2F2bf463b0765729189DeBe4E22dCEd601A18d5;
    address internal constant PAYMENT_VERIFIER = 0x10B2419e526Dc860E85c2315536389FA0D1269DA;

    address internal constant EXPECTED_FDC_VERIFICATION = 0x906507E0B64bcD494Db73bd0459d1C667e14B933;
    address internal constant EXPECTED_FTSO_V2 = 0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d;
    address internal constant EXPECTED_ASSET_MANAGER_FXRP = 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA;
    address internal constant FXRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    address internal constant CURRENT_TEE = 0x9F2e818133F95249F991334bA26b92df2c932b4E;

    bytes32 internal constant TEST_XRP_SOURCE_ID = bytes32("testXRP");
    uint64 internal constant MAX_PRICE_AGE = 300;
    // Current simulation estimates 5.44241 C2FLR at 2,000 gwei; round up fail-closed.
    uint256 internal constant MINIMUM_DEPLOYER_BALANCE = 6 ether;

    error WrongChain(uint256 actual);
    error WrongDeployer(address actual);
    error MissingDependencyCode(address dependency);
    error DependencyMismatch(bytes32 dependency, address actual, address expected);
    error SourceIdMismatch(bytes32 actual);
    error InsufficientDeploymentBalance(uint256 actual, uint256 minimum);

    function run() external returns (GuardManager guardManager) {
        if (block.chainid != 114) revert WrongChain(block.chainid);
        if (msg.sender != EXPECTED_DEPLOYER) revert WrongDeployer(msg.sender);
        if (EXPECTED_DEPLOYER.balance < MINIMUM_DEPLOYER_BALANCE) {
            revert InsufficientDeploymentBalance(EXPECTED_DEPLOYER.balance, MINIMUM_DEPLOYER_BALANCE);
        }

        _requireCode(VAULT);
        _requireCode(PRICE_READER);
        _requireCode(PAYMENT_VERIFIER);
        _requireCode(FXRP);

        _requireAddress("FdcVerification", address(ContractRegistry.getFdcVerification()), EXPECTED_FDC_VERIFICATION);
        _requireAddress("FtsoV2", address(ContractRegistry.getTestFtsoV2()), EXPECTED_FTSO_V2);
        address assetManager = address(ContractRegistry.getAssetManagerFXRP());
        _requireAddress("AssetManagerFXRP", assetManager, EXPECTED_ASSET_MANAGER_FXRP);
        _requireAddress("FXRP", address(IAssetManager(assetManager).fAsset()), FXRP);

        XrplPaymentVerifier verifier = XrplPaymentVerifier(PAYMENT_VERIFIER);
        _requireAddress("VerifierFDC", address(verifier.fdcVerification()), EXPECTED_FDC_VERIFICATION);
        bytes32 sourceId = verifier.expectedSourceId();
        if (sourceId != TEST_XRP_SOURCE_ID) revert SourceIdMismatch(sourceId);

        (uint256 priceUsd18, uint64 priceTimestamp) = XrpUsdPriceReader(PRICE_READER).getXrpUsdPriceUsd18();
        require(priceUsd18 != 0, "XRP/USD price is zero");

        console2.log("deployer", EXPECTED_DEPLOYER);
        console2.log("deployer balance", EXPECTED_DEPLOYER.balance);
        console2.log("existing ProtectionVault", VAULT);
        console2.log("existing XrpUsdPriceReader", PRICE_READER);
        console2.log("existing XrplPaymentVerifier", PAYMENT_VERIFIER);
        console2.log("FXRP", FXRP);
        console2.log("registered TEE", CURRENT_TEE);
        console2.log("XRP/USD priceUsd18", priceUsd18);
        console2.log("XRP/USD timestamp", priceTimestamp);

        vm.startBroadcast();
        guardManager = new GuardManager(
            VAULT,
            PAYMENT_VERIFIER,
            PRICE_READER,
            FXRP,
            0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE,
            65927,
            0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f,
            keccak256("https://crescentoid-earless-kelsi.ngrok-free.dev"),
            MAX_PRICE_AGE
        );
        vm.stopBroadcast();

        require(address(guardManager.protectionVault()) == VAULT, "vault wiring mismatch");
        require(address(guardManager.paymentVerifier()) == PAYMENT_VERIFIER, "verifier wiring mismatch");
        require(address(guardManager.priceReader()) == PRICE_READER, "reader wiring mismatch");
        require(address(guardManager.fxrp()) == FXRP, "FXRP wiring mismatch");
        require(guardManager.fxrpDecimals() == 6, "FXRP decimals mismatch");
        require(
            address(guardManager.teeManager()) == 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE,
            "TEE manager wiring mismatch"
        );
        require(guardManager.maxPriceAge() == MAX_PRICE_AGE, "price age wiring mismatch");

        console2.log("GuardManager", address(guardManager));
    }

    function _requireCode(address dependency) private view {
        if (dependency.code.length == 0) revert MissingDependencyCode(dependency);
    }

    function _requireAddress(bytes32 dependency, address actual, address expected) private pure {
        if (actual != expected) revert DependencyMismatch(dependency, actual, expected);
    }
}
