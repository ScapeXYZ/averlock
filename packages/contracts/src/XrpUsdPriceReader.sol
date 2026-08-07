// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {TestFtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/TestFtsoV2Interface.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title XrpUsdPriceReader
/// @notice Reads the real XRP/USD FTSOv2 block-latency feed on Coston2.
/// @dev The Coston2 test interface exposes read-only view calls to the registry-resolved FTSOv2
///      contract. Production integration must use the production interface and fee semantics.
contract XrpUsdPriceReader {
    /// @notice Category 1 (Crypto), name "XRP/USD", padded to bytes21.
    bytes21 public constant XRP_USD_FEED_ID = 0x015852502f55534400000000000000000000000000;

    /// @notice Number of XRP drops in one XRP.
    uint256 public constant DROPS_PER_XRP = 1_000_000;

    /// @notice Decimals used by normalized USD results from this reader.
    uint8 public constant NORMALIZED_USD_DECIMALS = 18;

    error UnsupportedDecimals(int8 decimals);

    /// @notice Reads the latest XRP/USD feed tuple without assuming its decimal count.
    /// @return rawValue Integer feed value reported by FTSOv2.
    /// @return decimals Decimal places that apply to `rawValue`.
    /// @return timestamp Timestamp of the feed update.
    function getXrpUsdPrice() external view returns (uint256 rawValue, int8 decimals, uint64 timestamp) {
        TestFtsoV2Interface ftsoV2 = ContractRegistry.getTestFtsoV2();
        return ftsoV2.getFeedById(XRP_USD_FEED_ID);
    }

    /// @notice Reads XRP/USD normalized to 18 USD decimals.
    /// @return priceUsd18 USD price of one XRP scaled by 1e18.
    /// @return timestamp Timestamp of the feed update.
    function getXrpUsdPriceUsd18() external view returns (uint256 priceUsd18, uint64 timestamp) {
        (uint256 rawValue, int8 decimals, uint64 feedTimestamp) =
            ContractRegistry.getTestFtsoV2().getFeedById(XRP_USD_FEED_ID);
        return (normalizePriceUsd18(rawValue, decimals), feedTimestamp);
    }

    /// @notice Converts an FTSOv2 price tuple to an 18-decimal USD price.
    /// @dev Integer division rounds down when the source has more than 18 decimals.
    function normalizePriceUsd18(uint256 rawValue, int8 decimals) public pure returns (uint256) {
        if (rawValue == 0) return 0;

        int256 decimalShift = int256(uint256(NORMALIZED_USD_DECIMALS)) - int256(decimals);
        if (decimalShift >= 0) {
            if (decimalShift > 77) revert UnsupportedDecimals(decimals);
            // Safe because decimalShift is checked to be in [0, 77].
            // forge-lint: disable-next-line(unsafe-typecast)
            return Math.mulDiv(rawValue, 10 ** uint256(decimalShift), 1);
        }

        int256 divisorShift = -decimalShift;
        if (divisorShift > 77) return 0;
        // Safe because divisorShift is checked to be in [1, 77].
        // forge-lint: disable-next-line(unsafe-typecast)
        return rawValue / (10 ** uint256(divisorShift));
    }

    /// @notice Values an XRP amount in USD using an FTSOv2 price tuple.
    /// @param xrpDrops XRP amount in drops, where 1 XRP equals 1,000,000 drops.
    /// @param rawPrice Integer XRP/USD feed value.
    /// @param priceDecimals Decimal places reported alongside `rawPrice`.
    /// @return usdValue18 USD value rounded down and scaled by 1e18.
    function xrpDropsToUsd18(uint256 xrpDrops, uint256 rawPrice, int8 priceDecimals)
        external
        pure
        returns (uint256 usdValue18)
    {
        uint256 priceUsd18 = normalizePriceUsd18(rawPrice, priceDecimals);
        return Math.mulDiv(xrpDrops, priceUsd18, DROPS_PER_XRP);
    }
}
