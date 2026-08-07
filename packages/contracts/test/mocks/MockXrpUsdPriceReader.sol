// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice TEST-ONLY deterministic price source; never represents a real FTSO read.
contract MockXrpUsdPriceReader {
    uint256 public priceUsd18;
    uint64 public timestamp;

    function setPrice(uint256 price, uint64 updatedAt) external {
        priceUsd18 = price;
        timestamp = updatedAt;
    }

    function getXrpUsdPriceUsd18() external view returns (uint256, uint64) {
        return (priceUsd18, timestamp);
    }
}
