// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EntoleRouter} from "../src/EntoleRouter.sol";
import {MockAuth3009} from "../src/mocks/MockAuth3009.sol";

/// @notice What matters here: one signature moves `amount + fee`, the split is
/// atomic, and no relayer can change who is paid or how much.
contract EntoleRouterTest is Test {
    MockAuth3009 token;
    EntoleRouter router;

    address treasury = makeAddr("treasury");
    address recipient = makeAddr("recipient");
    address relayer = makeAddr("relayer");
    uint256 payerKey = 0xA11CE;
    address payer;

    // 0.5%, min 0.10, max 2.50 (6 decimals)
    uint256 constant BPS = 50;
    uint256 constant MIN_FEE = 100_000;
    uint256 constant MAX_FEE = 2_500_000;

    function setUp() public {
        payer = vm.addr(payerKey);
        token = new MockAuth3009();
        router = new EntoleRouter(address(token), treasury, BPS, MIN_FEE, MAX_FEE);
        token.mint(payer, 10_000e6);
        vm.warp(1_000_000);
    }

    function _sign(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), payer, to, value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(payerKey, digest);
    }

    /// The payer's side: sign amount + fee to the router with the terms in the nonce.
    function _signPayment(address to, uint256 amount, bytes32 salt)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        uint256 fee = router.feeFor(amount);
        bytes32 nonce = router.paymentNonce(to, amount, fee, salt);
        return _sign(address(router), amount + fee, 0, block.timestamp + 1 hours, nonce);
    }

    function _pay(address to, uint256 amount, bytes32 salt) internal {
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(to, amount, salt);
        vm.prank(relayer);
        router.pay(payer, to, amount, 0, block.timestamp + 1 hours, salt, v, r, s);
    }

    // ---- fee schedule ----

    function test_fee_isBpsOfTheAmountInTheMiddleOfTheRange() public view {
        assertEq(router.feeFor(100e6), 500_000); // 0.5% of 100 = 0.50
    }

    function test_fee_isFlooredAtTheMinimum() public view {
        assertEq(router.feeFor(1e6), MIN_FEE); // 0.5% of 1 = 0.005 -> 0.10
    }

    function test_fee_isCappedAtTheMaximum() public view {
        assertEq(router.feeFor(10_000e6), MAX_FEE); // 0.5% of 10,000 = 50 -> 2.50
    }

    // ---- the payment ----

    function test_pay_splitsOneSignatureIntoRecipientAndTreasury() public {
        _pay(recipient, 100e6, bytes32(uint256(1)));

        assertEq(token.balanceOf(recipient), 100e6);
        assertEq(token.balanceOf(treasury), 500_000);
        assertEq(token.balanceOf(payer), 10_000e6 - 100e6 - 500_000);
        assertEq(token.balanceOf(address(router)), 0, "router keeps nothing");
    }

    function test_pay_paysTheMinimumFeeOnASmallSend() public {
        _pay(recipient, 5e6, bytes32(uint256(2)));
        assertEq(token.balanceOf(treasury), MIN_FEE);
        assertEq(token.balanceOf(recipient), 5e6);
    }

    function test_pay_paysTheMaximumFeeOnALargeSend() public {
        _pay(recipient, 5_000e6, bytes32(uint256(3)));
        assertEq(token.balanceOf(treasury), MAX_FEE);
        assertEq(token.balanceOf(recipient), 5_000e6);
    }

    function test_pay_emitsThePaymentTerms() public {
        bytes32 salt = bytes32(uint256(4));
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(recipient, 100e6, salt);
        vm.expectEmit(true, true, false, true);
        emit EntoleRouter.Paid(payer, recipient, 100e6, 500_000, salt);
        vm.prank(relayer);
        router.pay(payer, recipient, 100e6, 0, block.timestamp + 1 hours, salt, v, r, s);
    }

    // ---- a relayer cannot change the terms ----

    function test_pay_revertsIfTheRelayerSwapsTheRecipient() public {
        bytes32 salt = bytes32(uint256(5));
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(recipient, 100e6, salt);
        vm.prank(relayer);
        vm.expectRevert(bytes("bad signature"));
        router.pay(payer, relayer, 100e6, 0, block.timestamp + 1 hours, salt, v, r, s);
        assertEq(token.balanceOf(relayer), 0);
    }

    function test_pay_revertsIfTheRelayerRaisesTheAmount() public {
        bytes32 salt = bytes32(uint256(6));
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(recipient, 100e6, salt);
        vm.prank(relayer);
        vm.expectRevert(bytes("bad signature"));
        router.pay(payer, recipient, 200e6, 0, block.timestamp + 1 hours, salt, v, r, s);
    }

    function test_pay_revertsIfTheRelayerChangesTheSalt() public {
        bytes32 salt = bytes32(uint256(7));
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(recipient, 100e6, salt);
        vm.prank(relayer);
        vm.expectRevert(bytes("bad signature"));
        router.pay(payer, recipient, 100e6, 0, block.timestamp + 1 hours, bytes32(uint256(8)), v, r, s);
    }

    // ---- replay, expiry, atomicity ----

    function test_pay_cannotBeReplayed() public {
        bytes32 salt = bytes32(uint256(9));
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(recipient, 100e6, salt);
        vm.startPrank(relayer);
        router.pay(payer, recipient, 100e6, 0, block.timestamp + 1 hours, salt, v, r, s);
        vm.expectRevert(bytes("used"));
        router.pay(payer, recipient, 100e6, 0, block.timestamp + 1 hours, salt, v, r, s);
        vm.stopPrank();
        assertEq(token.balanceOf(recipient), 100e6, "paid once");
    }

    function test_pay_revertsAfterTheAuthorizationExpires() public {
        bytes32 salt = bytes32(uint256(10));
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(recipient, 100e6, salt);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(relayer);
        vm.expectRevert(bytes("expired"));
        router.pay(payer, recipient, 100e6, 0, block.timestamp - 1 hours, salt, v, r, s);
    }

    function test_pay_revertsAtomicallyWhenThePayerCannotCoverAmountPlusFee() public {
        token.mint(address(0xBEEF), 0);
        // Payer holds 10,000; ask for 10,000 + fee (> balance).
        bytes32 salt = bytes32(uint256(11));
        (uint8 v, bytes32 r, bytes32 s) = _signPayment(recipient, 10_000e6, salt);
        vm.prank(relayer);
        vm.expectRevert(bytes("balance"));
        router.pay(payer, recipient, 10_000e6, 0, block.timestamp + 1 hours, salt, v, r, s);
        assertEq(token.balanceOf(payer), 10_000e6, "nothing moved");
        assertEq(token.balanceOf(recipient), 0);
        assertEq(token.balanceOf(treasury), 0);
    }

    function test_pay_revertsOnZeroAmountAndZeroRecipient() public {
        vm.startPrank(relayer);
        vm.expectRevert(EntoleRouter.ZeroAmount.selector);
        router.pay(payer, recipient, 0, 0, 1, bytes32(0), 27, bytes32(0), bytes32(0));
        vm.expectRevert(EntoleRouter.ZeroAddress.selector);
        router.pay(payer, address(0), 1e6, 0, 1, bytes32(0), 27, bytes32(0), bytes32(0));
        vm.stopPrank();
    }

    // ---- deploy-time guardrails ----

    function test_constructor_rejectsAFeeAboveFivePercent() public {
        vm.expectRevert(EntoleRouter.BadFeeConfig.selector);
        new EntoleRouter(address(token), treasury, 501, MIN_FEE, MAX_FEE);
    }

    function test_constructor_rejectsMinAboveMax() public {
        vm.expectRevert(EntoleRouter.BadFeeConfig.selector);
        new EntoleRouter(address(token), treasury, BPS, MAX_FEE + 1, MAX_FEE);
    }

    function test_constructor_rejectsZeroTreasury() public {
        vm.expectRevert(EntoleRouter.ZeroAddress.selector);
        new EntoleRouter(address(token), address(0), BPS, MIN_FEE, MAX_FEE);
    }
}
