// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BaseProtectionVault} from "./BaseProtectionVault.sol";

/// @title BaseGuardManager
/// @notice Transparent manual/cooldown protection guards for approved ERC-20 assets.
contract BaseGuardManager is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant VERSION = "1.0.0-sepolia";
    uint64 public constant MIN_RELEASE_DURATION = 1 hours;
    uint64 public constant MAX_RELEASE_DURATION = 365 days;
    uint64 public constant MAX_COOLDOWN = 365 days;

    enum GuardState { Draft, Registered, Funded, Eligible, Executed, VaultActive, Completed, Deactivated }
    enum GuardType { Cooldown, StablecoinProtection }

    struct Guard {
        uint256 id;
        address owner;
        address asset;
        uint256 amount;
        uint256 positionId;
        GuardType guardType;
        GuardState state;
        uint64 cooldown;
        uint64 releaseDuration;
        uint64 createdAt;
        uint64 fundedAt;
        uint64 eligibleAt;
        uint64 executedAt;
    }

    BaseProtectionVault public immutable protectionVault;
    uint256 private _nextGuardId = 1;
    mapping(uint256 guardId => Guard guard) private _guards;
    mapping(address asset => bool approved) public isApprovedAsset;

    event GuardCreated(
        uint256 indexed guardId, address indexed owner, address indexed asset, GuardType guardType,
        uint256 amount, uint64 cooldown, uint64 releaseDuration, uint64 createdAt
    );
    event GuardFunded(
        uint256 indexed guardId, address indexed owner, address indexed asset, uint256 amount,
        uint64 fundedAt, uint64 eligibleAt
    );
    event GuardStateChanged(
        uint256 indexed guardId, address indexed owner, GuardState previousState, GuardState newState,
        uint64 changedAt
    );
    event GuardExecuted(
        uint256 indexed guardId, address indexed owner, uint256 indexed positionId, address asset,
        uint256 amount, uint64 executedAt
    );
    event GuardCompleted(uint256 indexed guardId, address indexed owner, uint256 indexed positionId, uint64 completedAt);
    event GuardDeactivated(uint256 indexed guardId, address indexed owner, uint64 deactivatedAt);

    error ZeroAddress();
    error NoApprovedAssets();
    error AssetNotApproved(address asset);
    error ZeroAmount();
    error InvalidReleaseDuration(uint64 duration);
    error InvalidCooldown(uint64 cooldown);
    error GuardNotFound(uint256 guardId);
    error Unauthorized(address caller, address owner);
    error InvalidState(GuardState actual, GuardState expected);
    error GuardNotEligible(uint64 eligibleAt, uint64 currentTime);
    error UnexpectedTransferAmount(uint256 expected, uint256 received);
    error VaultNotCompleted(uint256 positionId);

    constructor(address vaultAddress, address[] memory approvedAssets) {
        if (vaultAddress == address(0)) revert ZeroAddress();
        if (approvedAssets.length == 0) revert NoApprovedAssets();
        protectionVault = BaseProtectionVault(vaultAddress);
        for (uint256 i; i < approvedAssets.length; ++i) {
            if (approvedAssets[i] == address(0)) revert ZeroAddress();
            isApprovedAsset[approvedAssets[i]] = true;
        }
    }

    function createGuard(
        GuardType guardType, address asset, uint256 amount, uint64 cooldown, uint64 releaseDuration
    ) external returns (uint256 guardId) {
        if (!isApprovedAsset[asset]) revert AssetNotApproved(asset);
        if (amount == 0) revert ZeroAmount();
        if (cooldown > MAX_COOLDOWN) revert InvalidCooldown(cooldown);
        if (releaseDuration < MIN_RELEASE_DURATION || releaseDuration > MAX_RELEASE_DURATION) {
            revert InvalidReleaseDuration(releaseDuration);
        }
        guardId = _nextGuardId++;
        uint64 createdAt = uint64(block.timestamp);
        _guards[guardId] = Guard({
            id: guardId, owner: msg.sender, asset: asset, amount: amount, positionId: 0,
            guardType: guardType, state: GuardState.Registered, cooldown: cooldown,
            releaseDuration: releaseDuration, createdAt: createdAt, fundedAt: 0,
            eligibleAt: 0, executedAt: 0
        });
        emit GuardCreated(guardId, msg.sender, asset, guardType, amount, cooldown, releaseDuration, createdAt);
        emit GuardStateChanged(guardId, msg.sender, GuardState.Draft, GuardState.Registered, createdAt);
    }

    function fundGuard(uint256 guardId) external nonReentrant {
        Guard storage guard = _guard(guardId);
        if (msg.sender != guard.owner) revert Unauthorized(msg.sender, guard.owner);
        _requireState(guard, GuardState.Registered);
        IERC20 token = IERC20(guard.asset);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(guard.owner, address(this), guard.amount);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        if (received != guard.amount) revert UnexpectedTransferAmount(guard.amount, received);
        uint64 fundedAt = uint64(block.timestamp);
        guard.fundedAt = fundedAt;
        guard.eligibleAt = fundedAt + guard.cooldown;
        _transition(guard, GuardState.Funded);
        emit GuardFunded(guardId, guard.owner, guard.asset, guard.amount, fundedAt, guard.eligibleAt);
    }

    function executeGuard(uint256 guardId) external nonReentrant returns (uint256 positionId) {
        Guard storage guard = _guard(guardId);
        _requireState(guard, GuardState.Funded);
        if (block.timestamp < guard.eligibleAt) revert GuardNotEligible(guard.eligibleAt, uint64(block.timestamp));
        _transition(guard, GuardState.Eligible);
        _transition(guard, GuardState.Executed);
        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = startTime + guard.releaseDuration;
        IERC20 token = IERC20(guard.asset);
        token.forceApprove(address(protectionVault), guard.amount);
        positionId = protectionVault.createPosition(guard.asset, guard.owner, guard.amount, startTime, endTime);
        token.forceApprove(address(protectionVault), 0);
        guard.positionId = positionId;
        guard.executedAt = startTime;
        _transition(guard, GuardState.VaultActive);
        emit GuardExecuted(guardId, guard.owner, positionId, guard.asset, guard.amount, startTime);
    }

    function completeGuard(uint256 guardId) external {
        Guard storage guard = _guard(guardId);
        _requireState(guard, GuardState.VaultActive);
        if (!protectionVault.isCompleted(guard.positionId)) revert VaultNotCompleted(guard.positionId);
        _transition(guard, GuardState.Completed);
        emit GuardCompleted(guardId, guard.owner, guard.positionId, uint64(block.timestamp));
    }

    function deactivateGuard(uint256 guardId) external {
        Guard storage guard = _guard(guardId);
        if (msg.sender != guard.owner) revert Unauthorized(msg.sender, guard.owner);
        _requireState(guard, GuardState.Registered);
        _transition(guard, GuardState.Deactivated);
        emit GuardDeactivated(guardId, guard.owner, uint64(block.timestamp));
    }

    function getGuard(uint256 guardId) external view returns (Guard memory) { return _guard(guardId); }
    function guardCount() external view returns (uint256) { return _nextGuardId - 1; }

    function currentState(uint256 guardId) external view returns (GuardState) {
        Guard storage guard = _guard(guardId);
        if (guard.state == GuardState.Funded && block.timestamp >= guard.eligibleAt) return GuardState.Eligible;
        if (guard.state == GuardState.VaultActive && protectionVault.isCompleted(guard.positionId)) {
            return GuardState.Completed;
        }
        return guard.state;
    }

    function _guard(uint256 guardId) private view returns (Guard storage guard) {
        guard = _guards[guardId];
        if (guard.id == 0) revert GuardNotFound(guardId);
    }

    function _requireState(Guard storage guard, GuardState expected) private view {
        if (guard.state != expected) revert InvalidState(guard.state, expected);
    }

    function _transition(Guard storage guard, GuardState next) private {
        GuardState previous = guard.state;
        guard.state = next;
        emit GuardStateChanged(guard.id, guard.owner, previous, next, uint64(block.timestamp));
    }
}
