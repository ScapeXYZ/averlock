// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {XrpUsdPriceReader} from "../src/XrpUsdPriceReader.sol";

contract XrpUsdPriceReaderTest is Test {
    XrpUsdPriceReader private reader;

    function setUp() public {
        reader = new XrpUsdPriceReader();
    }

    function testFeedIdMatchesOfficialXrpUsdEncoding() public view {
        assertEq(reader.XRP_USD_FEED_ID(), bytes21(0x015852502f55534400000000000000000000000000));
    }

    function testNormalizesTypicalFeedDecimals() public view {
        assertEq(reader.normalizePriceUsd18(250_000, 5), 2.5 ether);
        assertEq(reader.normalizePriceUsd18(123_456_789, 8), 1_234_567_890_000_000_000);
    }

    function testNormalizesEighteenDecimalsWithoutScaling() public view {
        assertEq(reader.normalizePriceUsd18(2.5 ether, 18), 2.5 ether);
    }

    function testDecimalsAboveEighteenRoundDown() public view {
        assertEq(reader.normalizePriceUsd18(123_456_789_012_345_678_999, 20), 1_234_567_890_123_456_789);
    }

    function testNegativeDecimalsAreHandled() public view {
        assertEq(reader.normalizePriceUsd18(2, -1), 20 ether);
    }

    function testUnsupportedDecimalScalingReverts() public {
        vm.expectRevert(abi.encodeWithSelector(XrpUsdPriceReader.UnsupportedDecimals.selector, int8(-60)));
        reader.normalizePriceUsd18(1, -60);
    }

    function testZeroXrpAmountReturnsZeroUsd() public view {
        assertEq(reader.xrpDropsToUsd18(0, 250_000, 5), 0);
    }

    function testSmallXrpAmountUsesDrops() public view {
        assertEq(reader.xrpDropsToUsd18(1, 250_000, 5), 2_500_000_000_000);
    }

    function testLargeXrpAmountUsesOverflowSafeMath() public view {
        uint256 oneTrillionXrpInDrops = 1_000_000_000_000 * reader.DROPS_PER_XRP();
        assertEq(reader.xrpDropsToUsd18(oneTrillionXrpInDrops, 250_000, 5), 2_500_000_000_000 ether);
    }

    function testValuationRoundsDown() public view {
        assertEq(reader.xrpDropsToUsd18(1, 1, 18), 0);
    }

    function testRealisticOneThousandXrpValuation() public view {
        uint256 oneThousandXrpInDrops = 1_000 * reader.DROPS_PER_XRP();
        assertEq(reader.xrpDropsToUsd18(oneThousandXrpInDrops, 250_000, 5), 2_500 ether);
    }
}
