// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EntolePolicy} from "../src/EntolePolicy.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Every test here is checking the one sentence the product is
/// built on: the assistant proposes, and cannot make a payment that falls
/// outside its allowance, because the contract does not consult the
/// assistant, the app, or the backend.
contract EntolePolicyTest is Test {
    EntolePolicy policy;
    MockERC20 token;

    address owner = makeAddr("owner");
    address delegate = makeAddr("delegate");
    address recipient = makeAddr("recipient");
    address stranger = makeAddr("stranger");

    bytes32 constant ID = keccak256("send-mom-monthly");

    uint256 constant PER_RUN = 50_000e6;
    uint256 constant PERIOD_CAP = 100_000e6;
    uint256 constant PERIOD = 30 days;

    function setUp() public {
        policy = new EntolePolicy();
        token = new MockERC20();

        token.mint(owner, 1_000_000e6);
        vm.prank(owner);
        token.approve(address(policy), type(uint256).max);
    }

    function _createDefaultAllowance() internal {
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;

        vm.prank(owner);
        policy.createAllowance(
            ID, delegate, address(token), recipients, PER_RUN, PERIOD_CAP, PERIOD, block.timestamp + 365 days
        );
    }

    // ── creation is owner-only ──────────────────────────────────────────

    function test_createAllowance_storesCaveats() public {
        _createDefaultAllowance();
        (address o, address d, address t, uint256 perRun, uint256 cap,,,, uint256 expiresAt, bool revoked) =
            policy.allowances(ID);

        assertEq(o, owner);
        assertEq(d, delegate);
        assertEq(t, address(token));
        assertEq(perRun, PER_RUN);
        assertEq(cap, PERIOD_CAP);
        assertEq(expiresAt, block.timestamp + 365 days);
        assertFalse(revoked);
        assertTrue(policy.recipientAllowed(ID, recipient));
        assertFalse(policy.recipientAllowed(ID, stranger));
    }

    function test_createAllowance_rejectsZeroPeriod() public {
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        vm.prank(owner);
        vm.expectRevert(EntolePolicy.InvalidPeriod.selector);
        policy.createAllowance(ID, delegate, address(token), recipients, PER_RUN, PERIOD_CAP, 0, block.timestamp + 1);
    }

    // ── execute: the assistant can pay inside the allowance ────────────

    function test_execute_movesFundsFromOwnerNotFromContract() public {
        _createDefaultAllowance();

        vm.prank(delegate);
        policy.execute(ID, recipient, 10_000e6);

        assertEq(token.balanceOf(recipient), 10_000e6);
        assertEq(token.balanceOf(owner), 990_000e6);
        assertEq(token.balanceOf(address(policy)), 0, "policy contract must never hold funds");
    }

    // ── the assistant cannot exceed its allowance: this is the product ──

    function test_execute_revertsOverPerRunMax() public {
        _createDefaultAllowance();
        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.OverPerRunMax.selector);
        policy.execute(ID, recipient, PER_RUN + 1);
    }

    function test_execute_revertsOverPeriodCap_evenAcrossMultipleRunsUnderPerRunMax() public {
        _createDefaultAllowance();

        vm.startPrank(delegate);
        policy.execute(ID, recipient, 40_000e6);
        policy.execute(ID, recipient, 40_000e6);
        // 80k spent, cap is 100k, this run is under per-run max but blows the cap
        vm.expectRevert(EntolePolicy.OverPeriodCap.selector);
        policy.execute(ID, recipient, 30_000e6);
        vm.stopPrank();
    }

    function test_execute_revertsForRecipientNotOnAllowList() public {
        _createDefaultAllowance();
        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.RecipientNotAllowed.selector);
        policy.execute(ID, stranger, 1_000e6);
    }

    function test_execute_revertsForCallerThatIsNotTheDelegate() public {
        _createDefaultAllowance();
        vm.prank(stranger);
        vm.expectRevert(EntolePolicy.NotDelegate.selector);
        policy.execute(ID, recipient, 1_000e6);
    }

    function test_execute_revertsAfterExpiry() public {
        _createDefaultAllowance();
        vm.warp(block.timestamp + 366 days);
        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.Expired.selector);
        policy.execute(ID, recipient, 1_000e6);
    }

    // ── periods roll over, they do not accumulate forever ──────────────

    function test_execute_periodCapResetsAfterPeriodElapses() public {
        _createDefaultAllowance();

        vm.startPrank(delegate);
        policy.execute(ID, recipient, PER_RUN); // 50k of 100k cap
        policy.execute(ID, recipient, PER_RUN); // 100k of 100k cap, exactly at the line

        vm.expectRevert(EntolePolicy.OverPeriodCap.selector);
        policy.execute(ID, recipient, 1);

        vm.warp(block.timestamp + PERIOD + 1);

        policy.execute(ID, recipient, PER_RUN);
        policy.execute(ID, recipient, PER_RUN);
        vm.stopPrank();

        assertEq(token.balanceOf(recipient), PERIOD_CAP * 2);
    }

    // ── revocation is immediate and owner-only ──────────────────────────

    function test_revoke_blocksFutureExecuteImmediately() public {
        _createDefaultAllowance();

        vm.prank(owner);
        policy.revoke(ID);

        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.AlreadyRevoked.selector);
        policy.execute(ID, recipient, 1);
    }

    function test_revoke_revertsForNonOwner() public {
        _createDefaultAllowance();
        vm.prank(stranger);
        vm.expectRevert(EntolePolicy.NotOwner.selector);
        policy.revoke(ID);
    }

    function test_revoke_revertsIfAlreadyRevoked() public {
        _createDefaultAllowance();
        vm.startPrank(owner);
        policy.revoke(ID);
        vm.expectRevert(EntolePolicy.AlreadyRevoked.selector);
        policy.revoke(ID);
        vm.stopPrank();
    }

    // ── pause blocks everything for an owner in one call ────────────────

    function test_setPaused_blocksExecuteAcrossAllOwnersAllowances() public {
        _createDefaultAllowance();

        bytes32 secondId = keccak256("send-rent-weekly");
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        vm.prank(owner);
        policy.createAllowance(
            secondId, delegate, address(token), recipients, PER_RUN, PERIOD_CAP, 7 days, block.timestamp + 365 days
        );

        vm.prank(owner);
        policy.setPaused(true);

        vm.startPrank(delegate);
        vm.expectRevert(EntolePolicy.AccountPaused.selector);
        policy.execute(ID, recipient, 1);
        vm.expectRevert(EntolePolicy.AccountPaused.selector);
        policy.execute(secondId, recipient, 1);
        vm.stopPrank();

        vm.prank(owner);
        policy.setPaused(false);

        vm.prank(delegate);
        policy.execute(ID, recipient, 1);
    }

    function test_setPaused_doesNotAffectAnotherOwnersAllowance() public {
        _createDefaultAllowance();

        address otherOwner = makeAddr("otherOwner");
        token.mint(otherOwner, 1_000_000e6);
        vm.prank(otherOwner);
        token.approve(address(policy), type(uint256).max);

        bytes32 otherId = keccak256("other-owner-allowance");
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        vm.prank(otherOwner);
        policy.createAllowance(
            otherId, delegate, address(token), recipients, PER_RUN, PERIOD_CAP, PERIOD, block.timestamp + 365 days
        );

        vm.prank(owner);
        policy.setPaused(true);

        // owner's pause must not reach otherOwner's allowance
        vm.prank(delegate);
        policy.execute(otherId, recipient, 1_000e6);
        assertEq(token.balanceOf(recipient), 1_000e6);
    }

    // ── wouldExceed mirrors execute's real decision ─────────────────────

    function test_wouldExceed_agreesWithExecute_forPerRunViolation() public {
        _createDefaultAllowance();
        assertTrue(policy.wouldExceed(ID, recipient, PER_RUN + 1));

        vm.prank(delegate);
        vm.expectRevert(EntolePolicy.OverPerRunMax.selector);
        policy.execute(ID, recipient, PER_RUN + 1);
    }

    function test_wouldExceed_agreesWithExecute_afterRevocation() public {
        _createDefaultAllowance();
        vm.prank(owner);
        policy.revoke(ID);

        assertTrue(policy.wouldExceed(ID, recipient, 1));
    }

    function test_wouldExceed_falseForAValidRun() public {
        _createDefaultAllowance();
        assertFalse(policy.wouldExceed(ID, recipient, 1_000e6));
    }

    // ── revocation by a bare passkey signature, not just a session key ──

    /// @notice Signs the exact digest `revokeWithPasskey` re-derives, via a
    /// fixed test key in script/sign_p256.py over Foundry's FFI cheatcode,
    /// then confirms the RIP-7212 precompile accepts it and the allowance
    /// revokes.
    ///
    /// Verified: forking Monad testnet is NOT enough — forking mirrors
    /// on-chain state, but precompile execution runs in Foundry's local
    /// revm interpreter, which does not implement Monad's RIP-7212 opcode.
    /// This test self-skips under every local/fork configuration we have,
    /// confirmed by running it with FOUNDRY_PROFILE=ffi against
    /// --fork-url https://testnet-rpc.monad.xyz. It only turns green against
    /// a real transaction on deployed Monad testnet — see
    /// contracts/README.md's "Proving the P256 path" section.
    function test_revokeWithPasskey_realSignature() public {
        (bool probeOk, bytes memory probeOut) =
            policy.P256_VERIFIER().staticcall(abi.encode(bytes32(0), bytes32(0), bytes32(0), uint256(0), uint256(0)));
        if (!probeOk || probeOut.length != 32) {
            vm.skip(true);
            return;
        }

        _createDefaultAllowance();
        bytes32 digest = keccak256(abi.encode(address(policy), block.chainid, ID, "revoke"));

        string[] memory cmd = new string[](3);
        cmd[0] = "python3";
        cmd[1] = "script/sign_p256.py";
        cmd[2] = vm.toString(digest);
        bytes memory result = vm.ffi(cmd);
        (uint256 x, uint256 y, uint256 r, uint256 s) = abi.decode(result, (uint256, uint256, uint256, uint256));

        vm.prank(owner);
        policy.registerPasskey(x, y);

        policy.revokeWithPasskey(ID, bytes32(r), bytes32(s));

        (,,,,,,,,, bool revoked) = policy.allowances(ID);
        assertTrue(revoked);
    }

    // ── the delegate itself never holds funds, only permission ─────────

    function test_delegateNeverCustodiesFunds() public {
        _createDefaultAllowance();
        assertEq(token.balanceOf(delegate), 0);

        vm.prank(delegate);
        policy.execute(ID, recipient, 1_000e6);

        assertEq(token.balanceOf(delegate), 0, "delegate must never receive the funds it moves");
    }

    // ── createAllowance cannot be hijacked or leave stale recipients ───

    function test_createAllowance_revertsWhenAnotherOwnerClaimsTheId() public {
        _createDefaultAllowance();

        address[] memory recipients = new address[](1);
        recipients[0] = stranger;
        vm.prank(stranger);
        vm.expectRevert(EntolePolicy.IdTaken.selector);
        policy.createAllowance(
            ID, stranger, address(token), recipients, PER_RUN, PERIOD_CAP, PERIOD, block.timestamp + 365 days
        );

        (address o, address d,,,,,,,,) = policy.allowances(ID);
        assertEq(o, owner);
        assertEq(d, delegate);
    }

    function test_createAllowance_ownerReplaceClearsOldRecipients() public {
        _createDefaultAllowance();
        assertTrue(policy.recipientAllowed(ID, recipient));

        address[] memory recipients = new address[](1);
        recipients[0] = stranger;
        vm.prank(owner);
        policy.createAllowance(
            ID, delegate, address(token), recipients, PER_RUN, PERIOD_CAP, PERIOD, block.timestamp + 365 days
        );

        assertFalse(policy.recipientAllowed(ID, recipient), "old recipient must not survive a replace");
        assertTrue(policy.recipientAllowed(ID, stranger));
    }

    // ── executeFor: gasless, delegate-signed execution ─────────────────

    uint256 delegateKey;
    address signingDelegate;

    function _createSignedDelegateAllowance() internal {
        (signingDelegate, delegateKey) = makeAddrAndKey("signingDelegate");
        address[] memory recipients = new address[](1);
        recipients[0] = recipient;
        vm.prank(owner);
        policy.createAllowance(
            ID, signingDelegate, address(token), recipients, PER_RUN, PERIOD_CAP, PERIOD, block.timestamp + 365 days
        );
    }

    function _sign(uint256 key, bytes32 id, address to, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(policy.EXECUTE_TYPEHASH(), id, to, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", policy.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_executeFor_sponsorSubmitsDelegateSignature() public {
        _createSignedDelegateAllowance();
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(delegateKey, ID, recipient, 10_000e6, 0, deadline);

        vm.prank(stranger); // the sponsor: holds the gas, not the authority
        policy.executeFor(ID, recipient, 10_000e6, deadline, sig);

        assertEq(token.balanceOf(recipient), 10_000e6);
        assertEq(token.balanceOf(owner), 990_000e6);
        assertEq(token.balanceOf(signingDelegate), 0);
        assertEq(policy.nonces(signingDelegate), 1);
    }

    function test_executeFor_revertsOnReplay() public {
        _createSignedDelegateAllowance();
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(delegateKey, ID, recipient, 10_000e6, 0, deadline);

        policy.executeFor(ID, recipient, 10_000e6, deadline, sig);
        vm.expectRevert(EntolePolicy.BadSignature.selector);
        policy.executeFor(ID, recipient, 10_000e6, deadline, sig);
    }

    function test_executeFor_revertsAfterDeadline() public {
        _createSignedDelegateAllowance();
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(delegateKey, ID, recipient, 10_000e6, 0, deadline);

        vm.warp(deadline + 1);
        vm.expectRevert(EntolePolicy.SignatureExpired.selector);
        policy.executeFor(ID, recipient, 10_000e6, deadline, sig);
    }

    function test_executeFor_revertsWhenSignedByWrongKey() public {
        _createSignedDelegateAllowance();
        (, uint256 otherKey) = makeAddrAndKey("other");
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(otherKey, ID, recipient, 10_000e6, 0, deadline);

        vm.expectRevert(EntolePolicy.BadSignature.selector);
        policy.executeFor(ID, recipient, 10_000e6, deadline, sig);
    }

    function test_executeFor_sponsorCannotSwapRecipientOrAmount() public {
        _createSignedDelegateAllowance();
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(delegateKey, ID, recipient, 10_000e6, 0, deadline);

        vm.expectRevert(EntolePolicy.BadSignature.selector);
        policy.executeFor(ID, stranger, 10_000e6, deadline, sig);
        vm.expectRevert(EntolePolicy.BadSignature.selector);
        policy.executeFor(ID, recipient, 20_000e6, deadline, sig);
    }

    function test_executeFor_stillEnforcesEveryCaveat() public {
        _createSignedDelegateAllowance();
        uint256 deadline = block.timestamp + 5 minutes;

        // over the per-run max
        bytes memory big = _sign(delegateKey, ID, recipient, PER_RUN + 1, 0, deadline);
        vm.expectRevert(EntolePolicy.OverPerRunMax.selector);
        policy.executeFor(ID, recipient, PER_RUN + 1, deadline, big);

        // paused
        vm.prank(owner);
        policy.setPaused(true);
        bytes memory ok = _sign(delegateKey, ID, recipient, 1_000e6, 0, deadline);
        vm.expectRevert(EntolePolicy.AccountPaused.selector);
        policy.executeFor(ID, recipient, 1_000e6, deadline, ok);

        // revoked
        vm.startPrank(owner);
        policy.setPaused(false);
        policy.revoke(ID);
        vm.stopPrank();
        vm.expectRevert(EntolePolicy.AlreadyRevoked.selector);
        policy.executeFor(ID, recipient, 1_000e6, deadline, ok);
    }

    function test_executeFor_revertsOverPeriodCapAcrossSignedRuns() public {
        _createSignedDelegateAllowance();
        uint256 deadline = block.timestamp + 5 minutes;

        policy.executeFor(ID, recipient, PER_RUN, deadline, _sign(delegateKey, ID, recipient, PER_RUN, 0, deadline));
        policy.executeFor(ID, recipient, PER_RUN, deadline, _sign(delegateKey, ID, recipient, PER_RUN, 1, deadline));
        bytes memory third = _sign(delegateKey, ID, recipient, 1, 2, deadline);
        vm.expectRevert(EntolePolicy.OverPeriodCap.selector);
        policy.executeFor(ID, recipient, 1, deadline, third);
    }

    function test_executeFor_revertsOnMalleatedSignature() public {
        _createSignedDelegateAllowance();
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(delegateKey, ID, recipient, 10_000e6, 0, deadline);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), uint8(v == 27 ? 28 : 27));

        vm.expectRevert(EntolePolicy.BadSignature.selector);
        policy.executeFor(ID, recipient, 10_000e6, deadline, flipped);
    }
}
