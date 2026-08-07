// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";

import {GuardManager} from "../src/GuardManager.sol";
import {FCCDecisionCodec} from "../src/FCCDecisionCodec.sol";
import {ProtectionVault} from "../src/ProtectionVault.sol";
import {XrplPaymentVerifier} from "../src/XrplPaymentVerifier.sol";
import {MockFdcVerification} from "./mocks/MockFdcVerification.sol";
import {MockXrpUsdPriceReader} from "./mocks/MockXrpUsdPriceReader.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockFlareTeeManager} from "./mocks/MockFlareTeeManager.sol";

contract GuardManagerTest is Test {
    using MessageHashUtils for bytes32;

    uint256 private constant TEE_KEY = 0xA11CE;
    bytes32 private constant SOURCE_ID = bytes32("testXRP");
    bytes32 private constant RULE = keccak256("rule-1");
    bytes32 private constant COMMITMENT = keccak256("private-policy");
    bytes32 private constant RECEIVER = keccak256("xrpl-receiver");
    bytes32 private constant TX_ID = keccak256("xrpl-transaction");
    address private owner = address(0xBEEF);

    ProtectionVault private vault;
    MockFdcVerification private fdc;
    MockXrpUsdPriceReader private price;
    TestERC20 private fxrp;
    GuardManager private manager;
    MockFlareTeeManager private teeManager;
    address private constant TEE_PROXY = address(0xCAFE);
    string private constant TEE_URL = "https://averlock.example";

    function setUp() public {
        vm.chainId(114);
        vm.warp(2_000_000_000);
        vault = new ProtectionVault();
        fdc = new MockFdcVerification();
        price = new MockXrpUsdPriceReader();
        price.setPrice(2e18, uint64(block.timestamp));
        fxrp = new TestERC20();
        XrplPaymentVerifier verifier = new XrplPaymentVerifier(address(fdc), SOURCE_ID);
        teeManager = new MockFlareTeeManager();
        teeManager.setMachine(vm.addr(TEE_KEY), TEE_PROXY, TEE_URL, 65927, 2);
        manager = new GuardManager(
            address(vault),
            address(verifier),
            address(price),
            address(fxrp),
            address(teeManager),
            65927,
            TEE_PROXY,
            keccak256(bytes(TEE_URL)),
            300
        );
        vm.prank(owner);
        manager.registerGuard(RULE, COMMITMENT, RECEIVER, 1);
        fxrp.mint(owner, 100e18);
        vm.prank(owner);
        fxrp.approve(address(manager), type(uint256).max);
    }

    function testGuardRegistration() public view {
        GuardManager.Guard memory guard = manager.getGuard(RULE);
        assertEq(guard.owner, owner);
        assertEq(guard.policyCommitment, COMMITMENT);
        assertTrue(guard.active);
    }

    function testDuplicateRuleRejected() public {
        vm.expectRevert(abi.encodeWithSelector(GuardManager.RuleAlreadyRegistered.selector, RULE));
        manager.registerGuard(RULE, COMMITMENT, RECEIVER, 1);
    }

    function testInvalidReceiverHashRejected() public {
        vm.expectRevert(GuardManager.ZeroReceiverHash.selector);
        manager.registerGuard(keccak256("other"), COMMITMENT, bytes32(0), 1);
    }

    function testUnsupportedScheduleRejected() public {
        vm.expectRevert(abi.encodeWithSelector(GuardManager.UnsupportedSchedule.selector, 2));
        manager.registerGuard(keccak256("other"), COMMITMENT, RECEIVER, 2);
    }

    function testValidPaymentTriggerCreatesVault() public {
        (bool triggered, uint256 positionId, uint256 amount) = _execute(true, 1, bytes32("action-1"));
        assertTrue(triggered);
        assertEq(positionId, 1);
        assertEq(amount, 7e18);
        assertEq(fxrp.balanceOf(address(vault)), 7e18);
    }

    function testReceiverMismatchRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        proof.data.responseBody.receivingAddressHash = keccak256("wrong");
        vm.expectRevert();
        vm.prank(owner);
        manager.prepareGuardEvaluation(RULE, proof);
    }

    function testPaymentFailureRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        proof.data.responseBody.status = 1;
        vm.expectRevert();
        vm.prank(owner);
        manager.prepareGuardEvaluation(RULE, proof);
    }

    function testInvalidFdcProofRejected() public {
        fdc.setValid(false);
        IXRPPayment.Proof memory proof = _proof();
        vm.expectRevert(XrplPaymentVerifier.InvalidXRPPaymentProof.selector);
        vm.prank(owner);
        manager.prepareGuardEvaluation(RULE, proof);
    }

    function testReplayedEventRejected() public {
        _execute(false, 1, bytes32("a"));
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, false, 2, bytes32("b"));
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert();
        manager.executeGuard(RULE, eventHash, result);
    }

    function testFtsoValuationCorrect() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, false, 1, bytes32("a"));
        FCCDecisionCodec.Decision memory decision = abi.decode(result.data, (FCCDecisionCodec.Decision));
        assertEq(decision.eventValueUsd18, 20e18);
    }

    function testStalePriceRejected() public {
        price.setPrice(2e18, uint64(block.timestamp - 301));
        IXRPPayment.Proof memory proof = _proof();
        vm.expectRevert();
        vm.prank(owner);
        manager.prepareGuardEvaluation(RULE, proof);
    }

    function testInvalidSignatureRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 1, bytes32("a"));
        result.signature[10] = bytes1(uint8(result.signature[10]) ^ 1);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert();
        manager.executeGuard(RULE, eventHash, result);
    }

    function testOldTeeNoLongerActiveRejected() public {
        teeManager.setMachine(vm.addr(TEE_KEY), TEE_PROXY, TEE_URL, 65927, 1);
        _expectRegistryRejected(abi.encodeWithSelector(GuardManager.InvalidTeeStatus.selector, uint8(1)));
    }

    function testCurrentProductionTeeAccepted() public {
        (bool triggered,,) = _execute(false, 77, bytes32("production-tee"));
        assertFalse(triggered);
    }

    function testUnregisteredTeeRejected() public {
        uint256 otherKey = 0xB0B;
        _expectSignerRejected(
            otherKey, abi.encodeWithSelector(GuardManager.InvalidTeeRegistration.selector, vm.addr(otherKey))
        );
    }

    function testWrongExtensionTeeRejected() public {
        teeManager.setMachine(vm.addr(TEE_KEY), TEE_PROXY, TEE_URL, 65928, 2);
        _expectRegistryRejected(abi.encodeWithSelector(GuardManager.InvalidTeeExtension.selector, 65928, 65927));
    }

    function testNonProductionTeeRejected() public {
        teeManager.setMachine(vm.addr(TEE_KEY), TEE_PROXY, TEE_URL, 65927, 1);
        _expectRegistryRejected(abi.encodeWithSelector(GuardManager.InvalidTeeStatus.selector, uint8(1)));
    }

    function testWrongRuleRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 1, bytes32("a"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.ruleId = keccak256("wrong");
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert(GuardManager.FccBindingMismatch.selector);
        manager.executeGuard(RULE, eventHash, result);
    }

    function testWrongEventHashRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 1, bytes32("a"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.eventHash = keccak256("wrong");
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert(GuardManager.FccBindingMismatch.selector);
        manager.executeGuard(RULE, eventHash, result);
    }

    function testWrongEventValueRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 1, bytes32("a"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.eventValueUsd18++;
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert(GuardManager.FccBindingMismatch.selector);
        manager.executeGuard(RULE, eventHash, result);
    }

    function testExpiredResultRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 1, bytes32("a"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.resultExpiry = uint64(block.timestamp - 1);
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert();
        manager.executeGuard(RULE, eventHash, result);
    }

    function testNonTriggerConsumesWithoutVault() public {
        (bool triggered, uint256 positionId, uint256 amount) = _execute(false, 1, bytes32("a"));
        assertFalse(triggered);
        assertEq(positionId, 0);
        assertEq(amount, 0);
        assertEq(vault.positionCount(), 0);
    }

    function testProtectedAmountRoundsDown() public {
        price.setPrice(3e18, uint64(block.timestamp));
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 1, bytes32("a"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.protectedUsd18 = 14e18;
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        (,, uint256 amount) = manager.executeGuard(RULE, _eventHash(proof), result);
        assertEq(amount, 4_666_666_666_666_666_666);
    }

    function testThirtyDaySchedule() public {
        (, uint256 id,) = _execute(true, 1, bytes32("a"));
        ProtectionVault.Position memory position = vault.getPosition(id);
        assertEq(position.endTimestamp - position.startTimestamp, 30 days);
    }

    function testInsufficientAllowanceRejected() public {
        vm.prank(owner);
        fxrp.approve(address(manager), 0);
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 1, bytes32("a"));
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert();
        manager.executeGuard(RULE, eventHash, result);
    }

    function testInsufficientBalanceRejected() public {
        address poor = address(0xCAFE);
        bytes32 otherRule = keccak256("poor-rule");
        vm.prank(poor);
        manager.registerGuard(otherRule, COMMITMENT, RECEIVER, 1);
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _resultFor(otherRule, proof, true, 1, bytes32("a"));
        _prepare(proof, poor, otherRule);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert();
        manager.executeGuard(otherRule, eventHash, result);
    }

    function testSameResultCannotExecuteTwice() public {
        _execute(false, 1, bytes32("a"));
        IXRPPayment.Proof memory proof = _proof();
        proof.data.requestBody.transactionId = keccak256("other-tx");
        GuardManager.FCCActionResult memory result = _result(proof, false, 2, bytes32("a"));
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert();
        manager.executeGuard(RULE, eventHash, result);
    }

    function testEventAndResultMarkedConsumed() public {
        IXRPPayment.Proof memory proof = _proof();
        bytes32 eventHash = _eventHash(proof);
        _execute(false, 7, bytes32("a"));
        assertTrue(manager.isEventConsumed(eventHash));
        assertTrue(manager.isResultConsumed(bytes32("a")));
        assertTrue(manager.isNonceUsed(RULE, 7));
    }

    function testPublicGuardContainsNoPrivateThreshold() public view {
        GuardManager.Guard memory guard = manager.getGuard(RULE);
        bytes memory publicData = abi.encode(guard);
        assertFalse(_containsWord(publicData, bytes32(uint256(1000e18))));
    }

    function testMultipleUsersIndependent() public {
        address second = address(0xCAFE);
        bytes32 secondRule = keccak256("rule-2");
        bytes32 secondReceiver = keccak256("receiver-2");
        vm.prank(second);
        manager.registerGuard(secondRule, keccak256("commit-2"), secondReceiver, 1);
        assertEq(manager.getGuard(secondRule).owner, second);
        assertEq(manager.getGuard(RULE).owner, owner);
    }

    function testVaultPositionRemainsNonCancelable() public {
        (, uint256 id,) = _execute(true, 1, bytes32("a"));
        (bool ok,) = address(vault).call(abi.encodeWithSignature("cancel(uint256)", id));
        assertFalse(ok);
        assertEq(vault.remainingLockedAmount(id), 7e18);
    }

    function testCanonicalEventHash() public view {
        bytes32 expected =
            keccak256(abi.encode(manager.XRPL_EVENT_DOMAIN(), TX_ID, RECEIVER, 10_000_000, uint64(block.timestamp)));
        assertEq(manager.deriveEventHash(TX_ID, RECEIVER, 10_000_000, uint64(block.timestamp)), expected);
    }

    function testOldFinalizedFdcPaymentCanReceiveFreshEvaluation() public {
        IXRPPayment.Proof memory proof = _proof();
        proof.data.responseBody.blockTimestamp = uint64(block.timestamp - 1 days);
        GuardManager.FCCActionResult memory result = _result(proof, false, 41, bytes32("old-payment"));
        _prepare(proof, owner, RULE);

        (bool triggered,,) = manager.executeGuard(RULE, _eventHash(proof), result);
        assertFalse(triggered);
        assertTrue(manager.isEventConsumed(_eventHash(proof)));
    }

    function testPaymentTimestampMutationChangesEventAndIsNotPrepared() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, false, 42, bytes32("timestamp"));
        _prepare(proof, owner, RULE);
        proof.data.responseBody.blockTimestamp--;
        bytes32 eventHash = _eventHash(proof);

        vm.expectRevert(abi.encodeWithSelector(GuardManager.EvaluationNotPrepared.selector, eventHash));
        manager.executeGuard(RULE, eventHash, result);
    }

    function testPriceSnapshotMismatchRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        _prepare(proof, owner, RULE);
        price.setPrice(3e18, uint64(block.timestamp));
        GuardManager.FCCActionResult memory result = _result(proof, false, 43, bytes32("new-price"));
        bytes32 eventHash = _eventHash(proof);

        vm.expectRevert(GuardManager.FccBindingMismatch.selector);
        manager.executeGuard(RULE, eventHash, result);
    }

    function testPriceMovementAfterSnapshotUsesStoredPrice() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 44, bytes32("stored-price"));
        _prepare(proof, owner, RULE);
        price.setPrice(3e18, uint64(block.timestamp));

        (,, uint256 amount) = manager.executeGuard(RULE, _eventHash(proof), result);
        assertEq(amount, 7e18);
    }

    function testOverlongFccResultWindowRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, false, 45, bytes32("long-window"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.resultExpiry = d.evaluatedAt + manager.MAX_RESULT_VALIDITY() + 1;
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);

        vm.expectRevert(
            abi.encodeWithSelector(GuardManager.InvalidResultWindow.selector, d.evaluatedAt, d.resultExpiry)
        );
        manager.executeGuard(RULE, eventHash, result);
    }

    function testThirtyOneMinuteOldPaymentCanBePrepared() public {
        IXRPPayment.Proof memory proof = _proof();
        proof.data.responseBody.blockTimestamp = uint64(block.timestamp - 1_862);
        bytes32 eventHash = _eventHash(proof);

        _prepare(proof, owner, RULE);

        GuardManager.EvaluationSnapshot memory snapshot = manager.getEvaluationSnapshot(eventHash);
        assertEq(snapshot.paymentTimestamp, block.timestamp - 1_862);
        assertEq(snapshot.preparedAt, block.timestamp);
        assertFalse(manager.isEventConsumed(eventHash));
    }

    function testSnapshotStoresExactPriceAndEventValue() public {
        IXRPPayment.Proof memory proof = _proof();
        (bytes32 eventHash, uint256 eventValue, uint256 snapshotPrice, uint64 priceTimestamp) =
            _prepareWithReturn(proof, owner, RULE);

        GuardManager.EvaluationSnapshot memory snapshot = manager.getEvaluationSnapshot(eventHash);
        assertEq(snapshot.ruleId, RULE);
        assertEq(snapshot.eventValueUsd18, 20e18);
        assertEq(snapshot.priceUsd18, 2e18);
        assertEq(snapshot.priceTimestamp, block.timestamp);
        assertEq(snapshot.paymentTimestamp, proof.data.responseBody.blockTimestamp);
        assertEq(snapshot.preparedAt, block.timestamp);
        assertEq(eventValue, snapshot.eventValueUsd18);
        assertEq(snapshotPrice, snapshot.priceUsd18);
        assertEq(priceTimestamp, snapshot.priceTimestamp);
    }

    function testNonOwnerCannotPrepare() public {
        IXRPPayment.Proof memory proof = _proof();
        address stranger = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(GuardManager.UnauthorizedGuardOwner.selector, stranger, owner));
        vm.prank(stranger);
        manager.prepareGuardEvaluation(RULE, proof);
    }

    function testSameEventCannotPrepareTwice() public {
        IXRPPayment.Proof memory proof = _proof();
        bytes32 eventHash = _eventHash(proof);
        _prepare(proof, owner, RULE);

        vm.expectRevert(abi.encodeWithSelector(GuardManager.EventAlreadyPrepared.selector, eventHash));
        vm.prank(owner);
        manager.prepareGuardEvaluation(RULE, proof);
    }

    function testEvaluationBeforePreparationRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, false, 46, bytes32("before-prepare"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.evaluatedAt = uint64(block.timestamp - 1);
        d.resultExpiry = d.evaluatedAt + 10 minutes;
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);

        vm.expectRevert(GuardManager.FccBindingMismatch.selector);
        manager.executeGuard(RULE, eventHash, result);
    }

    function testFutureEvaluationRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, false, 47, bytes32("future"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.evaluatedAt = uint64(block.timestamp + 1);
        d.resultExpiry = d.evaluatedAt + 10 minutes;
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);

        vm.expectRevert(GuardManager.FccBindingMismatch.selector);
        manager.executeGuard(RULE, eventHash, result);
    }

    function testNonceReplayRejectedAcrossDistinctEvents() public {
        _execute(false, 55, bytes32("nonce-first"));
        IXRPPayment.Proof memory proof = _proof();
        proof.data.requestBody.transactionId = keccak256("nonce-second-tx");
        GuardManager.FCCActionResult memory result = _result(proof, false, 55, bytes32("nonce-second"));
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);

        vm.expectRevert(abi.encodeWithSelector(GuardManager.NonceAlreadyUsed.selector, RULE, uint256(55)));
        manager.executeGuard(RULE, eventHash, result);
    }

    function testV1DecisionDomainRejected() public {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, false, 56, bytes32("v1"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        d.domain = keccak256("AVERLOCK_GUARD_RESULT_V1");
        result = _sign(d, result.actionId);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);

        vm.expectRevert(GuardManager.InvalidFccResultHash.selector);
        manager.executeGuard(RULE, eventHash, result);
    }

    function _execute(bool triggered, uint64 nonce, bytes32 actionId) private returns (bool, uint256, uint256) {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, triggered, nonce, actionId);
        _prepare(proof, owner, RULE);
        return manager.executeGuard(RULE, _eventHash(proof), result);
    }

    function _prepare(IXRPPayment.Proof memory proof, address guardOwner, bytes32 ruleId) private {
        vm.prank(guardOwner);
        manager.prepareGuardEvaluation(ruleId, proof);
    }

    function _prepareWithReturn(IXRPPayment.Proof memory proof, address guardOwner, bytes32 ruleId)
        private
        returns (bytes32 eventHash, uint256 eventValueUsd18, uint256 priceUsd18, uint64 priceTimestamp)
    {
        vm.prank(guardOwner);
        return manager.prepareGuardEvaluation(ruleId, proof);
    }

    function _proof() private view returns (IXRPPayment.Proof memory proof) {
        proof.data.attestationType = bytes32("XRPPayment");
        proof.data.sourceId = SOURCE_ID;
        proof.data.requestBody = IXRPPayment.RequestBody({transactionId: TX_ID, proofOwner: address(0)});
        proof.data.responseBody.receivingAddressHash = RECEIVER;
        proof.data.responseBody.receivedAmount = 10_000_000;
        proof.data.responseBody.blockTimestamp = uint64(block.timestamp);
        proof.data.responseBody.status = 0;
    }

    function _eventHash(IXRPPayment.Proof memory proof) private view returns (bytes32) {
        return manager.deriveEventHash(
            proof.data.requestBody.transactionId,
            proof.data.responseBody.receivingAddressHash,
            uint256(proof.data.responseBody.receivedAmount),
            proof.data.responseBody.blockTimestamp
        );
    }

    function _result(IXRPPayment.Proof memory proof, bool triggered, uint64 nonce, bytes32 actionId)
        private
        returns (GuardManager.FCCActionResult memory)
    {
        return _resultFor(RULE, proof, triggered, nonce, actionId);
    }

    function _resultFor(bytes32 ruleId, IXRPPayment.Proof memory proof, bool triggered, uint64 nonce, bytes32 actionId)
        private
        returns (GuardManager.FCCActionResult memory)
    {
        uint256 value = uint256(proof.data.responseBody.receivedAmount) * price.priceUsd18() / 1_000_000;
        FCCDecisionCodec.Decision memory d = FCCDecisionCodec.Decision({
            domain: manager.GUARD_RESULT_DOMAIN(),
            ruleId: ruleId,
            eventHash: _eventHash(proof),
            triggered: triggered,
            protectedUsd18: triggered ? value * 7000 / 10_000 : 0,
            protectBps: triggered ? 7000 : 0,
            scheduleId: triggered ? 1 : 0,
            eventValueUsd18: value,
            evaluatedAt: uint64(block.timestamp),
            nonce: nonce,
            resultExpiry: uint64(block.timestamp + 10 minutes)
        });
        return _sign(d, actionId);
    }

    function _sign(FCCDecisionCodec.Decision memory d, bytes32 actionId)
        private
        returns (GuardManager.FCCActionResult memory result)
    {
        return _signWithKey(d, actionId, TEE_KEY);
    }

    function _signWithKey(FCCDecisionCodec.Decision memory d, bytes32 actionId, uint256 key)
        private
        returns (GuardManager.FCCActionResult memory result)
    {
        result.actionId = actionId;
        result.submissionTag = "phase6-test";
        result.status = 1;
        result.data = abi.encode(d);
        bytes32 actionHash = keccak256(
            abi.encodePacked(keccak256(result.data), actionId, keccak256(bytes(result.submissionTag)), uint8(1))
        );
        bytes32 payload = keccak256(abi.encode(bytes32("TEE_ACTION_RESULT"), uint256(114), actionHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, payload.toEthSignedMessageHash());
        result.signature = abi.encodePacked(r, s, v);
    }

    function _expectRegistryRejected(bytes memory expectedError) private {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 501, bytes32("registry-reject"));
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert(expectedError);
        manager.executeGuard(RULE, eventHash, result);
    }

    function _expectSignerRejected(uint256 key, bytes memory expectedError) private {
        IXRPPayment.Proof memory proof = _proof();
        GuardManager.FCCActionResult memory result = _result(proof, true, 502, bytes32("signer-reject"));
        FCCDecisionCodec.Decision memory d = abi.decode(result.data, (FCCDecisionCodec.Decision));
        result = _signWithKey(d, result.actionId, key);
        _prepare(proof, owner, RULE);
        bytes32 eventHash = _eventHash(proof);
        vm.expectRevert(expectedError);
        manager.executeGuard(RULE, eventHash, result);
    }

    function _containsWord(bytes memory data, bytes32 word) private pure returns (bool) {
        if (data.length < 32) return false;
        for (uint256 i; i <= data.length - 32; ++i) {
            bytes32 candidate;
            assembly { candidate := mload(add(add(data, 0x20), i)) }
            if (candidate == word) return true;
        }
        return false;
    }
}
