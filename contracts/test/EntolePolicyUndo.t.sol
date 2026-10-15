// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EntolePolicy} from "../src/EntolePolicy.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice The undo window, held by the contract and not by the app: a run
/// waits, the owner can stop it, and a stolen assistant key cannot skip it.
contract EntolePolicyUndoTest is Test {
    EntolePolicy policy;
    MockERC20 token;

    address owner;
    uint256 ownerKey;
    address delegate;
    uint256 delegateKey;
    address recipient = makeAddr("recipient");
    address sponsor = makeAddr("sponsor");
    address stranger = makeAddr("stranger");

    bytes32 constant ID = keccak256("send-mum-monthly");
    uint256 constant PER_RUN = 50_000e6;
    uint256 constant PERIOD_CAP = 100_000e6;
    uint256 constant PERIOD = 30 days;
    uint256 constant UNDO = 10;

    function setUp() public {
        policy = new EntolePolicy();
        token = new MockERC20();
        (owner, ownerKey) = makeAddrAndKey("owner");
        (delegate, delegateKey) = makeAddrAndKey("delegate");

        token.mint(owner, 1_000_000e6);
        vm.prank(owner);
        token.approve(address(policy), type(uint256).max);
        _create(UNDO);
    }

    function _create(uint256 undoSeconds) internal {
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        vm.prank(owner);
        policy.createAllowance(
            ID,
            delegate,
            address(token),
            recipients,
            PER_RUN,
            PERIOD_CAP,
            PERIOD,
            block.timestamp + 365 days,
            undoSeconds
        );
    }

    function _propose(uint256 amount) internal returns (bytes32 runId) {
        vm.prank(delegate);
        runId = policy.propose(ID, recipient, amount);
    }

    function _signProposal(uint256 key, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(policy.PROPOSE_TYPEHASH(), ID, recipient, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", policy.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signCancel(uint256 key, bytes32 runId, uint256 deadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(policy.CANCEL_TYPEHASH(), runId, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", policy.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── the wait cannot be skipped ─────────────────────────────────────

    function test_execute_isRefusedWhenTheAllowanceHasAnUndoWindow() public {
        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.UndoWindowRequired.selector);
        policy.execute(ID, recipient, 10_000e6);
    }

    function test_executeFor_isRefusedWhenTheAllowanceHasAnUndoWindow() public {
        vm.expectRevert(EntolePolicy.UndoWindowRequired.selector);
        policy.executeFor(ID, recipient, 10_000e6, block.timestamp + 300, "");
    }

    function test_executePending_isRefusedBeforeTheWindowEnds() public {
        bytes32 runId = _propose(10_000e6);
        vm.warp(block.timestamp + UNDO - 1);
        vm.expectRevert(EntolePolicy.TooEarly.selector);
        policy.executePending(runId);
        assertEq(token.balanceOf(recipient), 0);
    }

    function test_executePending_paysOnceTheWindowHasPassed_andByAnyone() public {
        bytes32 runId = _propose(10_000e6);
        vm.warp(block.timestamp + UNDO);
        vm.expectEmit(true, true, false, false);
        emit EntolePolicy.RunCarriedOut(runId, ID);
        vm.prank(sponsor);
        policy.executePending(runId);
        assertEq(token.balanceOf(recipient), 10_000e6);
        assertEq(policy.reserved(ID), 0);

        vm.expectRevert(EntolePolicy.NoSuchRun.selector);
        policy.executePending(runId);
    }

    function test_executePending_isRefusedOnceTheRunHasGoneStale() public {
        bytes32 runId = _propose(10_000e6);
        vm.warp(block.timestamp + UNDO + policy.RUN_WINDOW() + 1);
        vm.expectRevert(EntolePolicy.RunExpired.selector);
        policy.executePending(runId);

        // Anyone may clear it, and it holds nothing back after.
        vm.prank(stranger);
        policy.cancel(runId);
        assertEq(policy.reserved(ID), 0);
    }

    // ── stopping it ────────────────────────────────────────────────────

    function test_ownerCancels_andNothingMoves() public {
        bytes32 runId = _propose(10_000e6);
        vm.prank(owner);
        policy.cancel(runId);
        vm.warp(block.timestamp + UNDO);
        vm.expectRevert(EntolePolicy.NoSuchRun.selector);
        policy.executePending(runId);
        assertEq(token.balanceOf(recipient), 0);
        assertEq(policy.reserved(ID), 0);
    }

    function test_delegateCancels() public {
        bytes32 runId = _propose(10_000e6);
        vm.prank(delegate);
        policy.cancel(runId);
        assertEq(policy.reserved(ID), 0);
    }

    function test_strangerCannotCancelALiveRun() public {
        bytes32 runId = _propose(10_000e6);
        vm.prank(stranger);
        vm.expectRevert(EntolePolicy.NotAllowedToCancel.selector);
        policy.cancel(runId);
    }

    function test_cancelFor_signedByTheOwnerOrTheDelegate_submittedBySponsor() public {
        bytes32 first = _propose(10_000e6);
        bytes32 second = _propose(10_000e6);
        uint256 deadline = block.timestamp + 300;

        vm.prank(sponsor);
        policy.cancelFor(first, deadline, _signCancel(ownerKey, first, deadline));
        vm.prank(sponsor);
        policy.cancelFor(second, deadline, _signCancel(delegateKey, second, deadline));
        assertEq(policy.reserved(ID), 0);

        // Good once: the run is gone.
        bytes memory again = _signCancel(ownerKey, first, deadline);
        vm.expectRevert(EntolePolicy.NoSuchRun.selector);
        policy.cancelFor(first, deadline, again);
    }

    function test_cancelFor_signedBySomeoneElse_isRefused() public {
        bytes32 runId = _propose(10_000e6);
        (, uint256 otherKey) = makeAddrAndKey("other");
        uint256 deadline = block.timestamp + 300;
        bytes memory signature = _signCancel(otherKey, runId, deadline);
        vm.expectRevert(EntolePolicy.NotAllowedToCancel.selector);
        policy.cancelFor(runId, deadline, signature);
    }

    function test_pauseDuringTheWindow_stopsTheRun() public {
        bytes32 runId = _propose(10_000e6);
        vm.prank(owner);
        policy.setPaused(true);
        vm.warp(block.timestamp + UNDO);
        vm.expectRevert(EntolePolicy.AccountPaused.selector);
        policy.executePending(runId);
    }

    function test_revocationDuringTheWindow_voidsTheRun() public {
        bytes32 runId = _propose(10_000e6);
        vm.prank(owner);
        policy.revoke(ID);
        vm.warp(block.timestamp + UNDO);
        vm.expectRevert(EntolePolicy.RunVoid.selector);
        policy.executePending(runId);
    }

    function test_replacingTheAllowance_voidsWhatWasWaiting() public {
        bytes32 runId = _propose(10_000e6);
        _create(UNDO);
        assertEq(policy.reserved(ID), 0);
        vm.warp(block.timestamp + UNDO);
        vm.expectRevert(EntolePolicy.RunVoid.selector);
        policy.executePending(runId);
    }

    // ── the cap counts what is waiting ─────────────────────────────────

    function test_runsWaitingTogether_cannotAddUpPastTheCap() public {
        _propose(50_000e6);
        _propose(50_000e6);
        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.OverPeriodCap.selector);
        policy.propose(ID, recipient, 1e6);
        assertTrue(policy.wouldExceed(ID, recipient, 1e6));
    }

    function test_proposeChecksEveryCaveat() public {
        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.OverPerRunMax.selector);
        policy.propose(ID, recipient, PER_RUN + 1);

        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.RecipientNotAllowed.selector);
        policy.propose(ID, stranger, 1e6);

        vm.prank(stranger);
        vm.expectRevert(EntolePolicy.NotDelegate.selector);
        policy.propose(ID, recipient, 1e6);
    }

    // ── signed by the delegate, submitted by the sponsor ───────────────

    function test_proposeFor_isSignedOnce() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory signature = _signProposal(delegateKey, 10_000e6, 0, deadline);
        vm.prank(sponsor);
        policy.proposeFor(ID, recipient, 10_000e6, deadline, signature);
        assertEq(policy.reserved(ID), 10_000e6);

        vm.expectRevert(EntolePolicy.BadSignature.selector);
        policy.proposeFor(ID, recipient, 10_000e6, deadline, signature);
    }

    function test_proposeFor_cannotBeRedirected() public {
        uint256 deadline = block.timestamp + 300;
        bytes memory signature = _signProposal(delegateKey, 10_000e6, 0, deadline);
        vm.expectRevert(EntolePolicy.BadSignature.selector);
        policy.proposeFor(ID, recipient, 20_000e6, deadline, signature);
    }

    // ── limits on the window itself ────────────────────────────────────

    function test_anUndoWindowLongerThanADay_isRefused() public {
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        vm.prank(owner);
        vm.expectRevert(EntolePolicy.UndoTooLong.selector);
        policy.createAllowance(
            keccak256("long"),
            delegate,
            address(token),
            recipients,
            PER_RUN,
            PERIOD_CAP,
            PERIOD,
            block.timestamp + 1 days,
            1 days + 1
        );
    }

    function test_withNoUndoWindow_executeStillWorks() public {
        _create(0);
        vm.prank(delegate);
        policy.execute(ID, recipient, 10_000e6);
        assertEq(token.balanceOf(recipient), 10_000e6);
    }
}
