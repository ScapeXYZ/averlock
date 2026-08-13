// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BaseProtectionVault} from "../../src/base/BaseProtectionVault.sol";
import {TestERC20} from "../mocks/TestERC20.sol";

contract BaseProtectionVaultInvariantTest is Test {
    BaseProtectionVault internal vault;
    TestERC20 internal token;

    function setUp() public {
        vault = new BaseProtectionVault();
        token = new TestERC20();
        token.mint(address(this), type(uint128).max);
        token.approve(address(vault), type(uint256).max);
    }

    function testFuzzClaimedNeverExceedsDeposit(uint128 amount, uint64 duration, uint64 elapsed) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        duration = uint64(bound(duration, 1, 365 days));
        elapsed = uint64(bound(elapsed, 0, duration + 1 days));
        uint64 start = uint64(block.timestamp);
        uint256 id = vault.createPosition(address(token), address(this), amount, start, start + duration);
        vm.warp(block.timestamp + elapsed);
        uint256 claimable = vault.claimableAmount(id);
        if (claimable > 0) vault.claim(id);
        BaseProtectionVault.Position memory position = vault.getPosition(id);
        assertLe(position.claimed, position.totalDeposited);
        assertEq(token.balanceOf(address(vault)), position.totalDeposited - position.claimed);
    }
}
