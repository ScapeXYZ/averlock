// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";

interface IDirectMintAssetManager {
    function directMintingPaymentAddress() external view returns (string memory);
    function getDirectMintingMinimumFeeUBA() external view returns (uint256);
    function getDirectMintingFeeBIPS() external view returns (uint256);
    function getDirectMintingExecutorFeeUBA() external view returns (uint256);
    function executeDirectMinting(IXRPPayment.Proof calldata payment) external payable;
}

/// @notice Executes only the already-proved Phase 6.3E direct mint.
contract ExecuteDirectMint is Script {
    string internal constant ARTIFACT = "../fdc-scripts/data/direct-mint-proof.local.json";
    address internal constant EXPECTED_SIGNER = 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f;
    address internal constant ASSET_MANAGER = 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA;
    address internal constant FTEST_XRP = 0x0b6A3645c240605887a5532109323A3E12273dc7;
    bytes32 internal constant EXPECTED_TRANSACTION_ID =
        0x0e16edc43a159df1ca34a02b76f8a9420d7f337cf85b098d44319f7eb21d4e82;
    uint256 internal constant RECEIVED_DROPS = 702_000_000;
    uint256 internal constant REQUIRED_BALANCE = 700_000_000;

    error WrongChain(uint256 actual);
    error WrongSigner(address actual);
    error InvalidProof();

    function run() external {
        if (block.chainid != 114) revert WrongChain(block.chainid);
        if (msg.sender != EXPECTED_SIGNER) revert WrongSigner(msg.sender);
        IXRPPayment.Proof memory proof =
            abi.decode(vm.parseJsonBytes(vm.readFile(ARTIFACT), ".proofAbi"), (IXRPPayment.Proof));
        if (
            proof.data.requestBody.transactionId != EXPECTED_TRANSACTION_ID
                || proof.data.requestBody.proofOwner != EXPECTED_SIGNER
                || proof.data.responseBody.receivedAmount != int256(RECEIVED_DROPS)
                || proof.data.responseBody.status != 0 || !proof.data.responseBody.hasMemoData
                || proof.data.responseBody.hasDestinationTag
        ) revert InvalidProof();

        IDirectMintAssetManager manager = IDirectMintAssetManager(ASSET_MANAGER);
        IERC20 token = IERC20(FTEST_XRP);
        uint256 beforeBalance = token.balanceOf(EXPECTED_SIGNER);
        uint256 feeBips = manager.getDirectMintingFeeBIPS();
        uint256 minimumFee = manager.getDirectMintingMinimumFeeUBA();
        uint256 executorFee = manager.getDirectMintingExecutorFeeUBA();
        uint256 percentageFee = RECEIVED_DROPS * feeBips / 10_000;
        uint256 mintingFee = percentageFee > minimumFee ? percentageFee : minimumFee;
        uint256 quotedNet = RECEIVED_DROPS - mintingFee - executorFee;

        console2.log("Core Vault", manager.directMintingPaymentAddress());
        console2.log("before FTestXRP", beforeBalance);
        console2.log("quoted minting fee", mintingFee);
        console2.log("executor fee", executorFee);
        console2.log("quoted net FTestXRP", quotedNet);

        vm.startBroadcast();
        manager.executeDirectMinting(proof);
        vm.stopBroadcast();

        uint256 afterBalance = token.balanceOf(EXPECTED_SIGNER);
        require(afterBalance >= REQUIRED_BALANCE, "minted balance below guard requirement");
        require(afterBalance - beforeBalance == quotedNet, "minted delta differs from live fee quote");
        console2.log("after FTestXRP", afterBalance);
        console2.log("minted FTestXRP", afterBalance - beforeBalance);
    }
}
