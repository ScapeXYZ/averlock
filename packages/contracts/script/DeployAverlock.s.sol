// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IAssetManager} from "@flarenetwork/flare-periphery-contracts/coston2/IAssetManager.sol";

import {ProtectionVault} from "../src/ProtectionVault.sol";
import {XrpUsdPriceReader} from "../src/XrpUsdPriceReader.sol";
import {XrplPaymentVerifier} from "../src/XrplPaymentVerifier.sol";
import {GuardManager} from "../src/GuardManager.sol";

/// @notice Deploys only the contracts required for AVERLOCK Phase 6 execution.
/// @dev Run first without --broadcast. Live broadcast must use the encrypted
///      Foundry account `averlock-fcc`; no private key environment variable is used.
contract DeployAverlock is Script {
    address internal constant EXPECTED_DEPLOYER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant EXPECTED_FDC_VERIFICATION = 0x906507E0B64bcD494Db73bd0459d1C667e14B933;
    address internal constant EXPECTED_FTSO_V2 = 0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d;
    address internal constant EXPECTED_ASSET_MANAGER_FXRP = 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA;
    address internal constant EXPECTED_FXRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    address internal constant CURRENT_TEE = 0x9F2e818133F95249F991334bA26b92df2c932b4E;

    bytes32 internal constant TEST_XRP_SOURCE_ID = bytes32("testXRP");
    uint64 internal constant MAX_PRICE_AGE = 300;

    error WrongChain(uint256 actual);
    error WrongDeployer(address actual);
    error RegistryMismatch(bytes32 name, address actual, address expected);
    error AssetManagerMismatch(address actual, address expected);

    function run()
        external
        returns (
            ProtectionVault vault,
            XrpUsdPriceReader priceReader,
            XrplPaymentVerifier paymentVerifier,
            GuardManager guardManager
        )
    {
        if (block.chainid != 114) revert WrongChain(block.chainid);
        if (msg.sender != EXPECTED_DEPLOYER) revert WrongDeployer(msg.sender);

        address fdcVerification = address(ContractRegistry.getFdcVerification());
        address ftsoV2 = address(ContractRegistry.getTestFtsoV2());
        address assetManagerFXRP = address(ContractRegistry.getAssetManagerFXRP());
        _requireAddress("FdcVerification", fdcVerification, EXPECTED_FDC_VERIFICATION);
        _requireAddress("FtsoV2", ftsoV2, EXPECTED_FTSO_V2);
        _requireAddress("AssetManagerFXRP", assetManagerFXRP, EXPECTED_ASSET_MANAGER_FXRP);

        address fxrp = address(IAssetManager(assetManagerFXRP).fAsset());
        if (fxrp != EXPECTED_FXRP) revert AssetManagerMismatch(fxrp, EXPECTED_FXRP);
        require(fdcVerification.code.length != 0, "FdcVerification has no code");
        require(ftsoV2.code.length != 0, "FtsoV2 has no code");
        require(assetManagerFXRP.code.length != 0, "AssetManagerFXRP has no code");
        require(fxrp.code.length != 0, "FXRP has no code");

        console2.log("deployer", msg.sender);
        console2.log("FdcVerification", fdcVerification);
        console2.log("FtsoV2", ftsoV2);
        console2.log("AssetManagerFXRP", assetManagerFXRP);
        console2.log("FXRP", fxrp);
        console2.log("FXRP symbol", IERC20Metadata(fxrp).symbol());
        console2.log("FXRP decimals", IERC20Metadata(fxrp).decimals());
        console2.log("registered TEE", CURRENT_TEE);

        vm.startBroadcast();
        vault = new ProtectionVault();
        priceReader = new XrpUsdPriceReader();
        paymentVerifier = new XrplPaymentVerifier(fdcVerification, TEST_XRP_SOURCE_ID);
        guardManager = new GuardManager(
            address(vault),
            address(paymentVerifier),
            address(priceReader),
            fxrp,
            0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE,
            65927,
            0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f,
            keccak256("https://crescentoid-earless-kelsi.ngrok-free.dev"),
            MAX_PRICE_AGE
        );
        vm.stopBroadcast();

        require(address(guardManager.protectionVault()) == address(vault), "vault wiring mismatch");
        require(address(guardManager.paymentVerifier()) == address(paymentVerifier), "verifier wiring mismatch");
        require(address(guardManager.priceReader()) == address(priceReader), "reader wiring mismatch");
        require(address(guardManager.fxrp()) == fxrp, "FXRP wiring mismatch");
        require(
            address(guardManager.teeManager()) == 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE,
            "TEE manager wiring mismatch"
        );
        require(guardManager.maxPriceAge() == MAX_PRICE_AGE, "price age wiring mismatch");

        (uint256 priceUsd18, uint64 timestamp) = priceReader.getXrpUsdPriceUsd18();
        console2.log("ProtectionVault", address(vault));
        console2.log("XrpUsdPriceReader", address(priceReader));
        console2.log("XrplPaymentVerifier", address(paymentVerifier));
        console2.log("GuardManager", address(guardManager));
        console2.log("XRP/USD priceUsd18", priceUsd18);
        console2.log("XRP/USD timestamp", timestamp);
    }

    function _requireAddress(bytes32 name, address actual, address expected) private pure {
        if (actual != expected) revert RegistryMismatch(name, actual, expected);
    }
}
