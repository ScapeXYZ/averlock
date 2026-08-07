// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ProtectionVault
/// @notice Holds standard ERC-20 assets in independent, non-cancelable linear-release positions.
/// @dev Fee-on-transfer and rebasing assets are unsupported because position accounting assumes
///      stable balances and exact transfer amounts.
contract ProtectionVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Immutable release terms and mutable claim accounting for one position.
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

    /// @notice Emitted after an exact asset deposit creates a position.
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

    /// @notice Emitted when a beneficiary claims vested assets.
    event Claimed(
        uint256 indexed positionId,
        address indexed beneficiary,
        address indexed asset,
        uint256 amount,
        uint256 totalClaimed
    );

    error ZeroAsset();
    error ZeroBeneficiary();
    error ZeroAmount();
    error InvalidSchedule();
    error PositionNotFound(uint256 positionId);
    error UnauthorizedClaimant(address caller, address beneficiary);
    error NothingToClaim(uint256 positionId);
    error UnexpectedDepositAmount(address asset, uint256 expected, uint256 received);

    uint256 private _nextPositionId = 1;
    mapping(uint256 positionId => Position position) private _positions;

    /// @notice Creates a non-cancelable linear-release position funded by the caller.
    /// @param asset Standard ERC-20 token deposited into the vault.
    /// @param beneficiary Address exclusively entitled to claim vested tokens.
    /// @param amount Exact number of tokens to deposit.
    /// @param startTime Timestamp at or before which no tokens are vested.
    /// @param endTime Timestamp at or after which all tokens are vested.
    /// @return positionId Identifier assigned to the new position.
    function createPosition(address asset, address beneficiary, uint256 amount, uint64 startTime, uint64 endTime)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        if (asset == address(0)) revert ZeroAsset();
        if (beneficiary == address(0)) revert ZeroBeneficiary();
        if (amount == 0) revert ZeroAmount();
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidSchedule();

        IERC20 token = IERC20(asset);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = token.balanceOf(address(this));
        uint256 received = balanceAfter >= balanceBefore ? balanceAfter - balanceBefore : 0;
        if (received != amount) revert UnexpectedDepositAmount(asset, amount, received);

        positionId = _nextPositionId++;
        uint64 creationTimestamp = uint64(block.timestamp);
        _positions[positionId] = Position({
            id: positionId,
            asset: asset,
            beneficiary: beneficiary,
            totalDeposited: amount,
            claimed: 0,
            startTimestamp: startTime,
            endTimestamp: endTime,
            createdAt: creationTimestamp
        });

        emit PositionCreated(positionId, msg.sender, beneficiary, asset, amount, startTime, endTime, creationTimestamp);
    }

    /// @notice Claims all currently vested, unclaimed tokens for a position.
    /// @param positionId Position to claim from.
    /// @return amount Number of tokens transferred to the beneficiary.
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

    /// @notice Returns all stored data for a position.
    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _position(positionId);
    }

    /// @notice Returns the total amount vested at the current block timestamp.
    function vestedAmount(uint256 positionId) public view returns (uint256) {
        return _vestedAmount(_position(positionId));
    }

    /// @notice Returns vested tokens not yet claimed by the beneficiary.
    function claimableAmount(uint256 positionId) public view returns (uint256) {
        Position storage position = _position(positionId);
        return _vestedAmount(position) - position.claimed;
    }

    /// @notice Returns tokens that have not vested yet.
    function remainingLockedAmount(uint256 positionId) external view returns (uint256) {
        Position storage position = _position(positionId);
        return position.totalDeposited - _vestedAmount(position);
    }

    /// @notice Returns true once the position has reached its end timestamp.
    function isFullyVested(uint256 positionId) external view returns (bool) {
        Position storage position = _position(positionId);
        return block.timestamp >= position.endTimestamp;
    }

    /// @notice Returns the number of positions created so far.
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

        uint256 elapsed = block.timestamp - position.startTimestamp;
        uint256 duration = position.endTimestamp - position.startTimestamp;
        return Math.mulDiv(position.totalDeposited, elapsed, duration);
    }
}
