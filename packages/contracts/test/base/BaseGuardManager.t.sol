// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BaseGuardManager} from "../../src/base/BaseGuardManager.sol";
import {BaseProtectionVault} from "../../src/base/BaseProtectionVault.sol";
import {TestERC20, FeeOnTransferTestERC20} from "../mocks/TestERC20.sol";

contract BaseGuardManagerTest is Test {
    BaseProtectionVault internal vault;
    BaseGuardManager internal manager;
    TestERC20 internal token;
    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    uint256 internal constant AMOUNT = 500e18;

    function setUp() public {
        vault = new BaseProtectionVault();
        token = new TestERC20();
        address[] memory assets = new address[](1);
        assets[0] = address(token);
        manager = new BaseGuardManager(address(vault), assets);
        token.mint(owner, 1_000e18);
    }

    function testCompleteCooldownProtectionFlow() public {
        vm.prank(owner);
        uint256 guardId =
            manager.createGuard(BaseGuardManager.GuardType.Cooldown, address(token), AMOUNT, 1 days, 30 days);
        vm.prank(owner);
        token.approve(address(manager), AMOUNT);
        vm.prank(owner);
        manager.fundGuard(guardId);
        assertEq(token.balanceOf(address(manager)), AMOUNT);
        assertEq(uint256(manager.currentState(guardId)), uint256(BaseGuardManager.GuardState.Funded));

        vm.warp(block.timestamp + 1 days);
        assertEq(uint256(manager.currentState(guardId)), uint256(BaseGuardManager.GuardState.Eligible));
        vm.prank(relayer);
        uint256 positionId = manager.executeGuard(guardId);
        assertEq(token.balanceOf(address(manager)), 0);
        assertEq(token.balanceOf(address(vault)), AMOUNT);
        assertEq(uint256(manager.currentState(guardId)), uint256(BaseGuardManager.GuardState.VaultActive));

        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        assertEq(vault.claim(positionId), AMOUNT);
        manager.completeGuard(guardId);
        assertEq(uint256(manager.currentState(guardId)), uint256(BaseGuardManager.GuardState.Completed));
        assertEq(token.balanceOf(owner), 1_000e18);
    }

    function testStablecoinGuardUsesSameBoundedLifecycle() public {
        vm.prank(owner);
        uint256 id =
            manager.createGuard(BaseGuardManager.GuardType.StablecoinProtection, address(token), 100e18, 0, 7 days);
        vm.startPrank(owner);
        token.approve(address(manager), 100e18);
        manager.fundGuard(id);
        vm.stopPrank();
        manager.executeGuard(id);
        BaseGuardManager.Guard memory guard = manager.getGuard(id);
        assertEq(guard.amount, 100e18);
        assertEq(guard.positionId, 1);
    }

    function testOnlyOwnerCanFundOrDeactivate() public {
        vm.prank(owner);
        uint256 id = manager.createGuard(BaseGuardManager.GuardType.Cooldown, address(token), AMOUNT, 0, 1 days);
        vm.expectRevert(abi.encodeWithSelector(BaseGuardManager.Unauthorized.selector, relayer, owner));
        vm.prank(relayer);
        manager.fundGuard(id);
        vm.expectRevert(abi.encodeWithSelector(BaseGuardManager.Unauthorized.selector, relayer, owner));
        vm.prank(relayer);
        manager.deactivateGuard(id);
    }

    function testDeactivationOnlyBeforeFunding() public {
        vm.prank(owner);
        uint256 id = manager.createGuard(BaseGuardManager.GuardType.Cooldown, address(token), AMOUNT, 0, 1 days);
        vm.prank(owner);
        manager.deactivateGuard(id);
        vm.expectRevert();
        vm.prank(owner);
        manager.fundGuard(id);
    }

    function testCannotExecuteTwice() public {
        vm.prank(owner);
        uint256 id = manager.createGuard(BaseGuardManager.GuardType.Cooldown, address(token), AMOUNT, 0, 1 days);
        vm.startPrank(owner);
        token.approve(address(manager), AMOUNT);
        manager.fundGuard(id);
        vm.stopPrank();
        manager.executeGuard(id);
        vm.expectRevert();
        manager.executeGuard(id);
    }

    function testRejectsUnapprovedAndFeeOnTransferAssets() public {
        FeeOnTransferTestERC20 feeToken = new FeeOnTransferTestERC20();
        vm.expectRevert(abi.encodeWithSelector(BaseGuardManager.AssetNotApproved.selector, address(feeToken)));
        manager.createGuard(BaseGuardManager.GuardType.Cooldown, address(feeToken), AMOUNT, 0, 1 days);
    }

    function testFuzzScheduleBounds(uint64 cooldown, uint64 duration) public {
        cooldown = uint64(bound(cooldown, 0, manager.MAX_COOLDOWN()));
        duration = uint64(bound(duration, manager.MIN_RELEASE_DURATION(), manager.MAX_RELEASE_DURATION()));
        vm.prank(owner);
        uint256 id = manager.createGuard(BaseGuardManager.GuardType.Cooldown, address(token), 1, cooldown, duration);
        BaseGuardManager.Guard memory guard = manager.getGuard(id);
        assertEq(guard.cooldown, cooldown);
        assertEq(guard.releaseDuration, duration);
    }
}
