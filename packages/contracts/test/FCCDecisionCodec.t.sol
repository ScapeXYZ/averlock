// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FCCDecisionCodec} from "../src/FCCDecisionCodec.sol";

contract FCCDecisionCodecHarness {
    function decode(bytes calldata payload) external pure returns (FCCDecisionCodec.Decision memory) {
        return FCCDecisionCodec.decode(payload);
    }

    function encode(FCCDecisionCodec.Decision memory decision) external pure returns (bytes memory) {
        return FCCDecisionCodec.encode(decision);
    }

    function resultHash(FCCDecisionCodec.Decision memory decision) external pure returns (bytes32) {
        return FCCDecisionCodec.resultHash(decision, 114);
    }
}

contract FCCDecisionCodecTest is Test {
    FCCDecisionCodecHarness private codec;

    bytes private constant TRIGGERED =
        hex"29ee4f1dc357d1ebeceed3136bae12e24a3611344ef4f0ccac235bd9ef2783b000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000002222000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000004be4e7267b6ae000000000000000000000000000000000000000000000000000000000000000001b58000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000006c6b935b8bbd400000000000000000000000000000000000000000000000000000000000006b49d200000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000006b49d458";
    bytes private constant NON_TRIGGER =
        hex"29ee4f1dc357d1ebeceed3136bae12e24a3611344ef4f0ccac235bd9ef2783b000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000002222000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006c6b935b8bbd400000000000000000000000000000000000000000000000000000000000006b49d200000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000006b49d458";

    function setUp() public {
        codec = new FCCDecisionCodecHarness();
    }

    function testTriggeredGoGoldenVector() public view {
        bytes memory triggered = _withV2Domain(TRIGGERED);
        FCCDecisionCodec.Decision memory d = codec.decode(triggered);
        assertTrue(d.triggered);
        assertEq(d.protectedUsd18, 1400e18);
        assertEq(d.protectBps, 7000);
        assertEq(d.scheduleId, 1);
        assertEq(d.eventValueUsd18, 2000e18);
        assertEq(codec.encode(d), triggered);
        assertEq(codec.resultHash(d), 0xba84779793bf303b62eef13d5a656a1dba8e0ebef58becf3bd719544eee53e43);
    }

    function testNonTriggerGoGoldenVector() public view {
        bytes memory nonTrigger = _withV2Domain(NON_TRIGGER);
        FCCDecisionCodec.Decision memory d = codec.decode(nonTrigger);
        assertFalse(d.triggered);
        assertEq(d.protectedUsd18, 0);
        assertEq(d.protectBps, 0);
        assertEq(d.scheduleId, 0);
        assertEq(codec.encode(d), nonTrigger);
        assertEq(codec.resultHash(d), 0x85aa5a3a9c8130fc29447f745b49447108a8c18953920f131cd29adc14bc2df1);
    }

    function testMaximumUint16ProtectBpsBoundary() public view {
        FCCDecisionCodec.Decision memory d = codec.decode(_withV2Domain(TRIGGERED));
        d.protectBps = type(uint16).max;
        assertEq(codec.decode(codec.encode(d)).protectBps, type(uint16).max);
    }

    function testMalformedAndTruncatedPayloadsRejected() public {
        vm.expectRevert();
        codec.decode(hex"010203");
        bytes memory truncated = new bytes(TRIGGERED.length - 1);
        for (uint256 i; i < truncated.length; ++i) {
            truncated[i] = TRIGGERED[i];
        }
        vm.expectRevert();
        codec.decode(truncated);
    }

    function testExtraEncodingRejected() public {
        vm.expectRevert();
        codec.decode(bytes.concat(TRIGGERED, hex"00"));
    }

    function _withV2Domain(bytes memory payload) private pure returns (bytes memory) {
        bytes32 domain = keccak256("AVERLOCK_GUARD_RESULT_V2");
        assembly {
            mstore(add(payload, 0x20), domain)
        }
        return payload;
    }
}
