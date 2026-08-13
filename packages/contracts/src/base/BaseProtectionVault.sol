// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BaseProtectionVault
/// @notice Immutable, non-cancelable linear-release positions for standard ERC-20 assets.
contract BaseProtectionVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Position {
        uint256 id;
        address asset;
        address beneficiary;
        uint256 totalDeposited;
        uint256 claimed;
        uint64 startTimestamp;
        uint64 endTimestamp;
        uint64 createdAt;
    }

    event PositionCreated(
        uint256 indexed positionId,
        address indexed depositor,
        address indexed beneficiary,
        address asset,
        uint256 amount,
        uint64 startTimestamp,
        uint64 endTimestamp,
        uint64 createdAt
    );
    event Claimed(
        uint256 indexed positionId,
        address indexed beneficiary,
        address indexed asset,
        uint256 amount,
        uint256 totalClaimed
    );

    error ZeroAddress();
    error ZeroAmount();
    error InvalidSchedule();
    error PositionNotFound(uint256 positionId);
    error UnauthorizedClaimant(address caller, address beneficiary);
    error NothingToClaim(uint256 positionId);
    error UnexpectedDepositAmount(address asset, uint256 expected, uint256 received);

    uint256 private _nextPositionId = 1;
    mapping(uint256 positionId => Position position) private _positions;

    function createPosition(address asset, address beneficiary, uint256 amount, uint64 startTime, uint64 endTime)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        if (asset == address(0) || beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidSchedule();

        IERC20 token = IERC20(asset);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert UnexpectedDepositAmount(asset, amount, received);

        positionId = _nextPositionId++;
        uint64 createdAt = uint64(block.timestamp);
        _positions[positionId] = Position({
            id: positionId,
            asset: asset,
            beneficiary: beneficiary,
            totalDeposited: amount,
            claimed: 0,
            startTimestamp: startTime,
            endTimestamp: endTime,
            createdAt: createdAt
        });
        emit PositionCreated(positionId, msg.sender, beneficiary, asset, amount, startTime, endTime, createdAt);
    }

    function claim(uint256 positionId) external nonReentrant returns (uint256 amount) {
        Position storage position = _position(positionId);
        if (msg.sender != position.beneficiary) {
            revert UnauthorizedClaimant(msg.sender, position.beneficiary);
        }
        amount = _vestedAmount(position) - position.claimed;
        if (amount == 0) revert NothingToClaim(positionId);
        position.claimed += amount;
        IERC20(position.asset).safeTransfer(position.beneficiary, amount);
        emit Claimed(positionId, position.beneficiary, position.asset, amount, position.claimed);
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _position(positionId);
    }

    function vestedAmount(uint256 positionId) public view returns (uint256) {
        return _vestedAmount(_position(positionId));
    }

    function claimableAmount(uint256 positionId) public view returns (uint256) {
        Position storage position = _position(positionId);
        return _vestedAmount(position) - position.claimed;
    }

    function remainingLockedAmount(uint256 positionId) external view returns (uint256) {
        Position storage position = _position(positionId);
        return position.totalDeposited - _vestedAmount(position);
    }

    function isFullyVested(uint256 positionId) external view returns (bool) {
        return block.timestamp >= _position(positionId).endTimestamp;
    }

    function isCompleted(uint256 positionId) external view returns (bool) {
        Position storage position = _position(positionId);
        return position.claimed == position.totalDeposited;
    }

    function positionCount() external view returns (uint256) {
        return _nextPositionId - 1;
    }

    function _position(uint256 positionId) private view returns (Position storage position) {
        position = _positions[positionId];
        if (position.id == 0) revert PositionNotFound(positionId);
    }

    function _vestedAmount(Position storage position) private view returns (uint256) {
        if (block.timestamp <= position.startTimestamp) return 0;
        if (block.timestamp >= position.endTimestamp) return position.totalDeposited;
        return Math.mulDiv(
            position.totalDeposited, block.timestamp - position.startTimestamp,
            position.endTimestamp - position.startTimestamp
        );
    }
}
