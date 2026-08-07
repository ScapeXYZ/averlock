// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProtectionVault} from "../src/ProtectionVault.sol";
import {FeeOnTransferTestERC20, TestERC20} from "./mocks/TestERC20.sol";

contract ProtectionVaultTest is Test {
    uint256 private constant AMOUNT = 1_000 ether;
    uint64 private constant NOW = 1_800_000_000;
    uint64 private constant START = NOW + 1 days;
    uint64 private constant END = START + 30 days;

    address private depositor = makeAddr("depositor");
    address private beneficiary = makeAddr("beneficiary");
    address private other = makeAddr("other");

    ProtectionVault private vault;
    TestERC20 private token;

    function setUp() public {
        vm.warp(NOW);
        vault = new ProtectionVault();
        token = new TestERC20();
        token.mint(depositor, 10_000 ether);
        vm.prank(depositor);
        token.approve(address(vault), type(uint256).max);
    }

    function testPositionCreationWorks() public {
        vm.expectEmit(true, true, true, true);
        emit ProtectionVault.PositionCreated(1, depositor, beneficiary, address(token), AMOUNT, START, END, NOW);

        uint256 positionId = _createPosition(AMOUNT, beneficiary, START, END);
        ProtectionVault.Position memory position = vault.getPosition(positionId);

        assertEq(positionId, 1);
        assertEq(position.id, 1);
        assertEq(position.asset, address(token));
        assertEq(position.beneficiary, beneficiary);
        assertEq(position.totalDeposited, AMOUNT);
        assertEq(position.claimed, 0);
        assertEq(position.startTimestamp, START);
        assertEq(position.endTimestamp, END);
        assertEq(position.createdAt, NOW);
        assertEq(vault.positionCount(), 1);
    }

    function testTokensEnterVault() public {
        uint256 depositorBefore = token.balanceOf(depositor);
        _createPosition(AMOUNT, beneficiary, START, END);

        assertEq(token.balanceOf(address(vault)), AMOUNT);
        assertEq(token.balanceOf(depositor), depositorBefore - AMOUNT);
    }

    function testZeroAmountRejected() public {
        vm.prank(depositor);
        vm.expectRevert(ProtectionVault.ZeroAmount.selector);
        vault.createPosition(address(token), beneficiary, 0, START, END);
    }

    function testZeroBeneficiaryRejected() public {
        vm.prank(depositor);
        vm.expectRevert(ProtectionVault.ZeroBeneficiary.selector);
        vault.createPosition(address(token), address(0), AMOUNT, START, END);
    }

    function testZeroAssetRejected() public {
        vm.prank(depositor);
        vm.expectRevert(ProtectionVault.ZeroAsset.selector);
        vault.createPosition(address(0), beneficiary, AMOUNT, START, END);
    }

    function testInvalidTimeScheduleRejected() public {
        vm.prank(depositor);
        vm.expectRevert(ProtectionVault.InvalidSchedule.selector);
        vault.createPosition(address(token), beneficiary, AMOUNT, START, START);
    }

    function testAlreadyEndedScheduleRejected() public {
        vm.prank(depositor);
        vm.expectRevert(ProtectionVault.InvalidSchedule.selector);
        vault.createPosition(address(token), beneficiary, AMOUNT, NOW - 2, NOW - 1);
    }

    function testBeforeAndAtStartNothingIsClaimable() public {
        uint256 positionId = _createDefaultPosition();

        assertEq(vault.vestedAmount(positionId), 0);
        assertEq(vault.claimableAmount(positionId), 0);
        assertEq(vault.remainingLockedAmount(positionId), AMOUNT);

        vm.warp(START);
        assertEq(vault.vestedAmount(positionId), 0);
        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.NothingToClaim.selector, positionId));
        vault.claim(positionId);
    }

    function testHalfwayIsFiftyPercentVested() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(START + 15 days);

        assertEq(vault.vestedAmount(positionId), 500 ether);
        assertEq(vault.claimableAmount(positionId), 500 ether);
        assertEq(vault.remainingLockedAmount(positionId), 500 ether);
        assertFalse(vault.isFullyVested(positionId));
    }

    function testEndTimeIsFullyVested() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(END);

        assertEq(vault.vestedAmount(positionId), AMOUNT);
        assertEq(vault.claimableAmount(positionId), AMOUNT);
        assertEq(vault.remainingLockedAmount(positionId), 0);
        assertTrue(vault.isFullyVested(positionId));
    }

    function testBeneficiaryCanClaimVestedAmount() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(START + 15 days);

        vm.expectEmit(true, true, true, true);
        emit ProtectionVault.Claimed(positionId, beneficiary, address(token), 500 ether, 500 ether);
        vm.prank(beneficiary);
        uint256 claimed = vault.claim(positionId);

        assertEq(claimed, 500 ether);
        assertEq(token.balanceOf(beneficiary), 500 ether);
        assertEq(vault.getPosition(positionId).claimed, 500 ether);
    }

    function testNonBeneficiaryCannotClaimOrRedirect() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(END);

        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.UnauthorizedClaimant.selector, other, beneficiary));
        vault.claim(positionId);

        assertEq(token.balanceOf(other), 0);
        assertEq(token.balanceOf(beneficiary), 0);
        assertEq(token.balanceOf(address(vault)), AMOUNT);
    }

    function testDoubleClaimCannotExceedEntitlement() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(START + 15 days);

        vm.prank(beneficiary);
        vault.claim(positionId);

        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.NothingToClaim.selector, positionId));
        vault.claim(positionId);

        vm.warp(END);
        vm.prank(beneficiary);
        vault.claim(positionId);

        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.NothingToClaim.selector, positionId));
        vault.claim(positionId);
        assertEq(token.balanceOf(beneficiary), AMOUNT);
    }

    function testEarlyFullWithdrawalIsImpossible() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(START + 1 days);

        uint256 vested = vault.vestedAmount(positionId);
        vm.prank(beneficiary);
        uint256 claimed = vault.claim(positionId);

        assertEq(claimed, vested);
        assertLt(claimed, AMOUNT);
        assertEq(token.balanceOf(address(vault)), AMOUNT - vested);
        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.NothingToClaim.selector, positionId));
        vault.claim(positionId);
    }

    function testMultiplePositionsRemainIndependent() public {
        uint256 firstId = _createPosition(AMOUNT, beneficiary, START, END);
        uint256 secondAmount = 300 ether;
        uint64 secondStart = START + 10 days;
        uint64 secondEnd = END + 10 days;
        uint256 secondId = _createPosition(secondAmount, other, secondStart, secondEnd);

        vm.warp(START + 15 days);
        assertEq(vault.vestedAmount(firstId), 500 ether);
        assertEq(vault.vestedAmount(secondId), 50 ether);

        vm.prank(beneficiary);
        vault.claim(firstId);
        assertEq(token.balanceOf(beneficiary), 500 ether);
        assertEq(token.balanceOf(other), 0);
        assertEq(vault.claimableAmount(secondId), 50 ether);
        assertEq(vault.positionCount(), 2);
    }

    function testFinalClaimGivesExactTotalEntitlement() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(START + 10 days);

        vm.prank(beneficiary);
        uint256 firstClaim = vault.claim(positionId);
        vm.warp(END);
        vm.prank(beneficiary);
        uint256 finalClaim = vault.claim(positionId);

        assertEq(firstClaim + finalClaim, AMOUNT);
        assertEq(token.balanceOf(beneficiary), AMOUNT);
        assertEq(vault.getPosition(positionId).claimed, AMOUNT);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function testVaultRetainsStillLockedTokens() public {
        uint256 positionId = _createDefaultPosition();
        vm.warp(START + 15 days);

        vm.prank(beneficiary);
        vault.claim(positionId);

        assertEq(token.balanceOf(address(vault)), 500 ether);
        assertEq(vault.remainingLockedAmount(positionId), 500 ether);
    }

    function testThereIsNoAdminWithdrawalMechanism() public {
        _createDefaultPosition();

        vm.prank(other);
        (bool success,) =
            address(vault).call(abi.encodeWithSignature("withdraw(address,uint256)", address(token), AMOUNT));

        assertFalse(success);
        assertEq(token.balanceOf(address(vault)), AMOUNT);
        assertEq(token.balanceOf(other), 0);
    }

    function testUnknownPositionRejectedByReadsAndClaims() public {
        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.PositionNotFound.selector, 999));
        vault.getPosition(999);

        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.PositionNotFound.selector, 999));
        vault.claimableAmount(999);

        vm.expectRevert(abi.encodeWithSelector(ProtectionVault.PositionNotFound.selector, 999));
        vault.claim(999);
    }

    function testFeeOnTransferDepositRejected() public {
        FeeOnTransferTestERC20 feeToken = new FeeOnTransferTestERC20();
        feeToken.mint(depositor, AMOUNT);
        vm.startPrank(depositor);
        feeToken.approve(address(vault), AMOUNT);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProtectionVault.UnexpectedDepositAmount.selector, address(feeToken), AMOUNT, 990 ether
            )
        );
        vault.createPosition(address(feeToken), beneficiary, AMOUNT, START, END);
        vm.stopPrank();

        assertEq(feeToken.balanceOf(address(vault)), 0);
        assertEq(vault.positionCount(), 0);
    }

    function _createDefaultPosition() private returns (uint256) {
        return _createPosition(AMOUNT, beneficiary, START, END);
    }

    function _createPosition(uint256 amount, address positionBeneficiary, uint64 startTime, uint64 endTime)
        private
        returns (uint256)
    {
        vm.prank(depositor);
        return vault.createPosition(address(token), positionBeneficiary, amount, startTime, endTime);
    }
}
