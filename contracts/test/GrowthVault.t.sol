// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {GrowthVault} from "../src/GrowthVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Every test here checks one thing: the vault's ledger always
/// matches the real token balance it holds, and only a depositor can ever
/// move their own deposit.
contract GrowthVaultTest is Test {
    GrowthVault vault;
    MockERC20 token;

    address depositor = makeAddr("depositor");
    address otherDepositor = makeAddr("otherDepositor");

    function setUp() public {
        token = new MockERC20();
        vault = new GrowthVault(address(token));

        token.mint(depositor, 1_000_000e6);
        vm.prank(depositor);
        token.approve(address(vault), type(uint256).max);

        token.mint(otherDepositor, 1_000_000e6);
        vm.prank(otherDepositor);
        token.approve(address(vault), type(uint256).max);
    }

    function test_deposit_movesFundsIntoTheVaultAndCreditsTheOwner() public {
        vm.prank(depositor);
        vault.deposit(50_000e6);

        assertEq(vault.balanceOf(depositor), 50_000e6);
        assertEq(token.balanceOf(address(vault)), 50_000e6);
        assertEq(token.balanceOf(depositor), 950_000e6);
    }

    function test_deposit_revertsOnZeroAmount() public {
        vm.prank(depositor);
        vm.expectRevert(GrowthVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_accumulatesAcrossMultipleDeposits() public {
        vm.startPrank(depositor);
        vault.deposit(10_000e6);
        vault.deposit(15_000e6);
        vm.stopPrank();

        assertEq(vault.balanceOf(depositor), 25_000e6);
    }

    function test_withdraw_returnsFundsToTheOwner() public {
        vm.startPrank(depositor);
        vault.deposit(50_000e6);
        vault.withdraw(20_000e6);
        vm.stopPrank();

        assertEq(vault.balanceOf(depositor), 30_000e6);
        assertEq(token.balanceOf(depositor), 970_000e6);
        assertEq(token.balanceOf(address(vault)), 30_000e6);
    }

    function test_withdraw_revertsOnZeroAmount() public {
        vm.prank(depositor);
        vm.expectRevert(GrowthVault.ZeroAmount.selector);
        vault.withdraw(0);
    }

    function test_withdraw_revertsWhenOverOwnBalance() public {
        vm.startPrank(depositor);
        vault.deposit(10_000e6);
        vm.expectRevert(GrowthVault.InsufficientBalance.selector);
        vault.withdraw(10_000e6 + 1);
        vm.stopPrank();
    }

    function test_withdraw_cannotDrainAnotherDepositorsBalance() public {
        vm.prank(depositor);
        vault.deposit(50_000e6);

        // otherDepositor has never deposited — their own balance is zero,
        // so any withdraw attempt reverts on InsufficientBalance, never
        // reaching depositor's funds.
        vm.prank(otherDepositor);
        vm.expectRevert(GrowthVault.InsufficientBalance.selector);
        vault.withdraw(1);

        assertEq(vault.balanceOf(depositor), 50_000e6);
    }

    function test_deposit_emitsWithRunningBalance() public {
        vm.startPrank(depositor);
        vm.expectEmit(true, false, false, true);
        emit GrowthVault.Deposited(depositor, 10_000e6, 10_000e6);
        vault.deposit(10_000e6);

        vm.expectEmit(true, false, false, true);
        emit GrowthVault.Deposited(depositor, 5_000e6, 15_000e6);
        vault.deposit(5_000e6);
        vm.stopPrank();
    }
}
