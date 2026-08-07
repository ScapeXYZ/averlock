// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IXRPPayment} from "@flarenetwork/flare-periphery-contracts/coston2/IXRPPayment.sol";

import {ProtectionVault} from "./ProtectionVault.sol";
import {XrplPaymentVerifier} from "./XrplPaymentVerifier.sol";
import {FCCDecisionCodec} from "./FCCDecisionCodec.sol";
import {IFlareTeeManager} from "./interfaces/IFlareTeeManager.sol";

interface IXrpUsdPriceReader {
    function getXrpUsdPriceUsd18() external view returns (uint256 priceUsd18, uint64 timestamp);
}

/// @title GuardManager
/// @notice Connects verified XRPL payments, FTSOv2 valuation, signed FCC decisions, FXRP funding,
///         and non-cancelable ProtectionVault positions.
/// @dev V2 separates the FDC payment time, the onchain FTSO snapshot time, and the trusted FCC
///      evaluation time. A payment is prepared once before FCC evaluation, preventing price races.
contract GuardManager is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MessageHashUtils for bytes32;

    uint256 public constant COSTON2_CHAIN_ID = 114;
    uint256 public constant DROPS_PER_XRP = 1_000_000;
    uint32 public constant THIRTY_DAY_LINEAR = 1;
    uint64 public constant THIRTY_DAYS = 30 days;
    bytes32 public constant XRPL_EVENT_DOMAIN = keccak256("AVERLOCK_XRPL_EVENT_V1");
    bytes32 public constant GUARD_RESULT_DOMAIN = keccak256("AVERLOCK_GUARD_RESULT_V2");
    bytes32 public constant TEE_ACTION_RESULT_PREFIX = bytes32("TEE_ACTION_RESULT");
    uint64 public constant MAX_RESULT_VALIDITY = 10 minutes;

    struct Guard {
        address owner;
        bytes32 ruleId;
        bytes32 policyCommitment;
        bytes32 monitoredReceiverHash;
        uint32 scheduleId;
        bool active;
        uint64 createdAt;
    }

    struct FCCActionResult {
        bytes32 actionId;
        string submissionTag;
        uint8 status;
        bytes data;
        bytes signature;
    }

    struct ExecutionContext {
        bytes32 eventHash;
        uint256 eventValueUsd18;
        uint256 priceUsd18;
        uint64 priceTimestamp;
        uint64 paymentTimestamp;
    }

    struct EvaluationSnapshot {
        bytes32 ruleId;
        uint256 eventValueUsd18;
        uint256 priceUsd18;
        uint64 priceTimestamp;
        uint64 paymentTimestamp;
        uint64 preparedAt;
    }

    ProtectionVault public immutable protectionVault;
    XrplPaymentVerifier public immutable paymentVerifier;
    IXrpUsdPriceReader public immutable priceReader;
    IERC20Metadata public immutable fxrp;
    IFlareTeeManager public immutable teeManager;
    uint256 public immutable extensionId;
    address public immutable expectedTeeProxy;
    bytes32 public immutable expectedTeeUrlHash;
    uint64 public immutable maxPriceAge;
    uint8 public immutable fxrpDecimals;

    mapping(bytes32 ruleId => Guard guard) private _guards;
    mapping(bytes32 eventHash => bool consumed) private _consumedEvents;
    mapping(bytes32 actionId => bool consumed) private _consumedResults;
    mapping(bytes32 ruleId => mapping(uint256 nonce => bool used)) private _usedNonces;
    mapping(bytes32 eventHash => EvaluationSnapshot snapshot) private _evaluationSnapshots;

    event GuardRegistered(
        address indexed owner,
        bytes32 indexed ruleId,
        bytes32 indexed policyCommitment,
        bytes32 monitoredReceiverHash,
        uint32 scheduleId,
        uint64 createdAt
    );
    event GuardEvaluated(
        address indexed owner,
        bytes32 indexed ruleId,
        bytes32 indexed eventHash,
        bytes32 actionId,
        bool triggered,
        uint256 eventValueUsd18
    );
    event GuardTriggered(
        address indexed owner,
        bytes32 indexed ruleId,
        bytes32 indexed eventHash,
        uint256 vaultPositionId,
        uint256 fxrpAmountProtected,
        uint32 scheduleId
    );
    event GuardEvaluationPrepared(
        address indexed owner,
        bytes32 indexed ruleId,
        bytes32 indexed eventHash,
        uint256 eventValueUsd18,
        uint256 priceUsd18,
        uint64 priceTimestamp,
        uint64 paymentTimestamp
    );

    error ZeroAddress();
    error ZeroRuleId();
    error ZeroPolicyCommitment();
    error ZeroReceiverHash();
    error UnsupportedSchedule(uint32 scheduleId);
    error RuleAlreadyRegistered(bytes32 ruleId);
    error GuardNotFound(bytes32 ruleId);
    error GuardInactive(bytes32 ruleId);
    error ReceiverMismatch(bytes32 expected, bytes32 actual);
    error EventAlreadyConsumed(bytes32 eventHash);
    error ResultAlreadyConsumed(bytes32 actionId);
    error NonceAlreadyUsed(bytes32 ruleId, uint256 nonce);
    error InvalidChain(uint256 chainId);
    error InvalidFccStatus(uint8 status);
    error InvalidTeeSignature(address recovered, address expected);
    error InvalidTeeRegistration(address tee);
    error InvalidTeeExtension(uint256 actual, uint256 expected);
    error InvalidTeeStatus(uint8 status);
    error InvalidTeeProxy(address actual, address expected);
    error InvalidTeeUrl();
    error InvalidFccResultHash();
    error FccBindingMismatch();
    error FccResultExpired(uint64 expiry, uint256 currentTimestamp);
    error InvalidPrice();
    error StalePrice(uint64 timestamp, uint256 currentTimestamp);
    error UnsupportedTokenDecimals(uint8 decimals);
    error ZeroProtectedAmount();
    error UnexpectedTokenTransfer(uint256 expected, uint256 received);
    error ResidualManagerBalance(uint256 beforeBalance, uint256 afterBalance);
    error UnauthorizedGuardOwner(address caller, address owner);
    error EventAlreadyPrepared(bytes32 eventHash);
    error EvaluationNotPrepared(bytes32 eventHash);
    error InvalidResultWindow(uint64 evaluatedAt, uint64 resultExpiry);

    constructor(
        address vaultAddress,
        address paymentVerifierAddress,
        address priceReaderAddress,
        address fxrpAddress,
        address teeManagerAddress,
        uint256 expectedExtensionId,
        address teeProxyAddress,
        bytes32 teeUrlHash,
        uint64 acceptedPriceAge
    ) {
        if (
            vaultAddress == address(0) || paymentVerifierAddress == address(0) || priceReaderAddress == address(0)
                || fxrpAddress == address(0) || teeManagerAddress == address(0) || teeProxyAddress == address(0)
        ) revert ZeroAddress();
        if (expectedExtensionId == 0 || teeUrlHash == bytes32(0)) revert InvalidTeeRegistration(address(0));
        protectionVault = ProtectionVault(vaultAddress);
        paymentVerifier = XrplPaymentVerifier(paymentVerifierAddress);
        priceReader = IXrpUsdPriceReader(priceReaderAddress);
        fxrp = IERC20Metadata(fxrpAddress);
        teeManager = IFlareTeeManager(teeManagerAddress);
        extensionId = expectedExtensionId;
        expectedTeeProxy = teeProxyAddress;
        expectedTeeUrlHash = teeUrlHash;
        maxPriceAge = acceptedPriceAge;
        uint8 decimals = IERC20Metadata(fxrpAddress).decimals();
        if (decimals > 77) revert UnsupportedTokenDecimals(decimals);
        fxrpDecimals = decimals;
    }

    function registerGuard(bytes32 ruleId, bytes32 policyCommitment, bytes32 monitoredReceiverHash, uint32 scheduleId)
        external
    {
        if (ruleId == bytes32(0)) revert ZeroRuleId();
        if (policyCommitment == bytes32(0)) revert ZeroPolicyCommitment();
        if (monitoredReceiverHash == bytes32(0)) revert ZeroReceiverHash();
        if (scheduleId != THIRTY_DAY_LINEAR) revert UnsupportedSchedule(scheduleId);
        if (_guards[ruleId].owner != address(0)) revert RuleAlreadyRegistered(ruleId);

        uint64 createdAt = uint64(block.timestamp);
        _guards[ruleId] = Guard({
            owner: msg.sender,
            ruleId: ruleId,
            policyCommitment: policyCommitment,
            monitoredReceiverHash: monitoredReceiverHash,
            scheduleId: scheduleId,
            active: true,
            createdAt: createdAt
        });
        emit GuardRegistered(msg.sender, ruleId, policyCommitment, monitoredReceiverHash, scheduleId, createdAt);
    }

    /// @notice Verifies an XRPL payment and stores its one canonical onchain FTSO valuation.
    /// @dev The owner chooses when to snapshot. The immutable snapshot is then supplied to FCC.
    function prepareGuardEvaluation(bytes32 ruleId, IXRPPayment.Proof calldata paymentProof)
        external
        returns (bytes32 eventHash, uint256 eventValueUsd18, uint256 priceUsd18, uint64 priceTimestamp)
    {
        if (block.chainid != COSTON2_CHAIN_ID) revert InvalidChain(block.chainid);
        Guard storage guard = _guards[ruleId];
        if (guard.owner == address(0)) revert GuardNotFound(ruleId);
        if (!guard.active) revert GuardInactive(ruleId);
        if (msg.sender != guard.owner) revert UnauthorizedGuardOwner(msg.sender, guard.owner);

        ExecutionContext memory context = _verifyPaymentAndValue(guard, paymentProof);
        if (_consumedEvents[context.eventHash]) revert EventAlreadyConsumed(context.eventHash);
        if (_evaluationSnapshots[context.eventHash].ruleId != bytes32(0)) {
            revert EventAlreadyPrepared(context.eventHash);
        }

        _evaluationSnapshots[context.eventHash] = EvaluationSnapshot({
            ruleId: ruleId,
            eventValueUsd18: context.eventValueUsd18,
            priceUsd18: context.priceUsd18,
            priceTimestamp: context.priceTimestamp,
            paymentTimestamp: context.paymentTimestamp,
            preparedAt: uint64(block.timestamp)
        });
        emit GuardEvaluationPrepared(
            guard.owner,
            ruleId,
            context.eventHash,
            context.eventValueUsd18,
            context.priceUsd18,
            context.priceTimestamp,
            context.paymentTimestamp
        );
        return (context.eventHash, context.eventValueUsd18, context.priceUsd18, context.priceTimestamp);
    }

    /// @notice Executes a signed FCC decision against a previously stored FDC/FTSO snapshot.
    /// @dev Anyone may relay it; FXRP always comes from and vests back to the guard owner.
    function executeGuard(bytes32 ruleId, bytes32 eventHash, FCCActionResult calldata actionResult)
        external
        nonReentrant
        returns (bool triggered, uint256 positionId, uint256 fxrpAmount)
    {
        if (block.chainid != COSTON2_CHAIN_ID) revert InvalidChain(block.chainid);
        Guard storage guard = _guards[ruleId];
        if (guard.owner == address(0)) revert GuardNotFound(ruleId);
        if (!guard.active) revert GuardInactive(ruleId);
        EvaluationSnapshot memory snapshot = _evaluationSnapshots[eventHash];
        if (snapshot.ruleId == bytes32(0)) revert EvaluationNotPrepared(eventHash);
        if (snapshot.ruleId != ruleId) revert FccBindingMismatch();
        if (_consumedEvents[eventHash]) revert EventAlreadyConsumed(eventHash);
        if (_consumedResults[actionResult.actionId]) revert ResultAlreadyConsumed(actionResult.actionId);

        FCCDecisionCodec.Decision memory decision = _verifyFccResult(actionResult);
        if (
            decision.ruleId != ruleId || decision.eventHash != eventHash
                || decision.eventValueUsd18 != snapshot.eventValueUsd18 || decision.evaluatedAt < snapshot.preparedAt
                || decision.evaluatedAt > block.timestamp
                || (decision.triggered && decision.scheduleId != guard.scheduleId)
        ) revert FccBindingMismatch();
        if (
            decision.resultExpiry <= decision.evaluatedAt
                || decision.resultExpiry - decision.evaluatedAt > MAX_RESULT_VALIDITY
        ) revert InvalidResultWindow(decision.evaluatedAt, decision.resultExpiry);
        if (decision.resultExpiry < block.timestamp) revert FccResultExpired(decision.resultExpiry, block.timestamp);
        if (_usedNonces[ruleId][decision.nonce]) revert NonceAlreadyUsed(ruleId, decision.nonce);

        // Effects precede token/vault interactions; a revert rolls them back atomically.
        _consumedEvents[eventHash] = true;
        _consumedResults[actionResult.actionId] = true;
        _usedNonces[ruleId][decision.nonce] = true;
        emit GuardEvaluated(
            guard.owner, ruleId, eventHash, actionResult.actionId, decision.triggered, snapshot.eventValueUsd18
        );

        if (!decision.triggered) return (false, 0, 0);

        (positionId, fxrpAmount) = _createProtectionPosition(guard, decision.protectedUsd18, snapshot.priceUsd18);

        emit GuardTriggered(guard.owner, ruleId, eventHash, positionId, fxrpAmount, guard.scheduleId);
        return (true, positionId, fxrpAmount);
    }

    function getGuard(bytes32 ruleId) external view returns (Guard memory) {
        Guard memory guard = _guards[ruleId];
        if (guard.owner == address(0)) revert GuardNotFound(ruleId);
        return guard;
    }

    function deriveEventHash(
        bytes32 transactionId,
        bytes32 receivingAddressHash,
        uint256 receivedDrops,
        uint64 blockTimestamp
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(XRPL_EVENT_DOMAIN, transactionId, receivingAddressHash, receivedDrops, blockTimestamp)
        );
    }

    function scheduleDuration(uint32 scheduleId) public pure returns (uint64) {
        if (scheduleId != THIRTY_DAY_LINEAR) revert UnsupportedSchedule(scheduleId);
        return THIRTY_DAYS;
    }

    function isEventConsumed(bytes32 eventHash) external view returns (bool) {
        return _consumedEvents[eventHash];
    }

    function isResultConsumed(bytes32 actionId) external view returns (bool) {
        return _consumedResults[actionId];
    }

    function getEvaluationSnapshot(bytes32 eventHash) external view returns (EvaluationSnapshot memory) {
        EvaluationSnapshot memory snapshot = _evaluationSnapshots[eventHash];
        if (snapshot.ruleId == bytes32(0)) revert EvaluationNotPrepared(eventHash);
        return snapshot;
    }

    function isNonceUsed(bytes32 ruleId, uint256 nonce) external view returns (bool) {
        return _usedNonces[ruleId][nonce];
    }

    function _validatePrice(uint256 priceUsd18, uint64 timestamp) private view {
        if (priceUsd18 == 0 || timestamp > block.timestamp) revert InvalidPrice();
        if (block.timestamp - timestamp > maxPriceAge) revert StalePrice(timestamp, block.timestamp);
    }

    function _verifyPaymentAndValue(Guard storage guard, IXRPPayment.Proof calldata paymentProof)
        private
        view
        returns (ExecutionContext memory context)
    {
        XrplPaymentVerifier.PaymentData memory payment = paymentVerifier.verifyPayment(paymentProof);
        if (payment.receivingAddressHash != guard.monitoredReceiverHash) {
            revert ReceiverMismatch(guard.monitoredReceiverHash, payment.receivingAddressHash);
        }
        (uint256 priceUsd18, uint64 priceTimestamp) = priceReader.getXrpUsdPriceUsd18();
        _validatePrice(priceUsd18, priceTimestamp);
        context = ExecutionContext({
            eventHash: deriveEventHash(
                payment.transactionId, payment.receivingAddressHash, payment.receivedDrops, payment.blockTimestamp
            ),
            eventValueUsd18: Math.mulDiv(payment.receivedDrops, priceUsd18, DROPS_PER_XRP),
            priceUsd18: priceUsd18,
            priceTimestamp: priceTimestamp,
            paymentTimestamp: payment.blockTimestamp
        });
    }

    function _createProtectionPosition(Guard storage guard, uint256 protectedUsd18, uint256 priceUsd18)
        private
        returns (uint256 positionId, uint256 fxrpAmount)
    {
        fxrpAmount = Math.mulDiv(protectedUsd18, 10 ** uint256(fxrpDecimals), priceUsd18);
        if (fxrpAmount == 0) revert ZeroProtectedAmount();
        uint64 startTime = uint64(block.timestamp);
        uint64 endTime = startTime + scheduleDuration(guard.scheduleId);

        IERC20 token = IERC20(address(fxrp));
        uint256 managerBalanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(guard.owner, address(this), fxrpAmount);
        uint256 managerBalanceAfterTransfer = token.balanceOf(address(this));
        uint256 received = managerBalanceAfterTransfer >= managerBalanceBefore
            ? managerBalanceAfterTransfer - managerBalanceBefore
            : 0;
        if (received != fxrpAmount) revert UnexpectedTokenTransfer(fxrpAmount, received);

        token.forceApprove(address(protectionVault), fxrpAmount);
        positionId = protectionVault.createPosition(address(fxrp), guard.owner, fxrpAmount, startTime, endTime);
        token.forceApprove(address(protectionVault), 0);
        uint256 finalManagerBalance = token.balanceOf(address(this));
        if (finalManagerBalance != managerBalanceBefore) {
            revert ResidualManagerBalance(managerBalanceBefore, finalManagerBalance);
        }
    }

    function _verifyFccResult(FCCActionResult calldata actionResult)
        private
        view
        returns (FCCDecisionCodec.Decision memory decision)
    {
        if (actionResult.status != 1) {
            revert InvalidFccStatus(actionResult.status);
        }
        bytes32 actionResultHash = keccak256(
            abi.encodePacked(
                keccak256(actionResult.data),
                actionResult.actionId,
                keccak256(bytes(actionResult.submissionTag)),
                actionResult.status
            )
        );
        bytes32 payloadHash = keccak256(abi.encode(TEE_ACTION_RESULT_PREFIX, block.chainid, actionResultHash));
        address recovered = ECDSA.recover(payloadHash.toEthSignedMessageHash(), actionResult.signature);
        _verifyRegisteredTee(recovered);

        decision = FCCDecisionCodec.decode(actionResult.data);
        if (decision.domain != GUARD_RESULT_DOMAIN) revert InvalidFccResultHash();
    }

    function _verifyRegisteredTee(address recovered) private view {
        IFlareTeeManager.TeeMachine memory machine = teeManager.getTeeMachine(recovered);
        if (machine.teeId != recovered || recovered == address(0)) revert InvalidTeeRegistration(recovered);
        uint256 actualExtension = teeManager.getExtensionId(recovered);
        if (actualExtension != extensionId) revert InvalidTeeExtension(actualExtension, extensionId);
        uint8 status = teeManager.getTeeMachineStatus(recovered);
        if (status != 2) revert InvalidTeeStatus(status);
        if (machine.teeProxyId != expectedTeeProxy) revert InvalidTeeProxy(machine.teeProxyId, expectedTeeProxy);
        if (keccak256(bytes(machine.url)) != expectedTeeUrlHash) revert InvalidTeeUrl();
    }
}
