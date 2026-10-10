// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EntoleRouter} from "../src/EntoleRouter.sol";

interface IAusdMainnet {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
}

/// The ERC-4626 surface of Aave's wrapped AUSD deposit token.
interface ISavingsVault {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function balanceOf(address) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
}

/// @notice The two things Entole needs from Monad mainnet, run against the
/// deployed contracts on a fork so nothing is spent finding out:
///
/// 1. `EntoleRouter` works with the real Agora AUSD: one signature from the
///    payer, submitted by someone else, pays the recipient and the fee.
/// 2. Savings can sit in Aave's AUSD vault: money goes in from a plain account,
///    is worth more after time passes, and comes back out with the difference.
///
/// Skipped unless forked from mainnet:
///   forge test --fork-url monad_mainnet --match-contract MainnetFork -vv
contract MainnetForkTest is Test {
    address constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    /// Aave v3's AUSD deposit token on Monad. It holds the market's idle AUSD,
    /// which makes it the simplest account to fund a test payer from.
    address constant AAVE_AUSD = 0xdeBFeDF35faEd5d1664E553545e144C02227A2Ec;
    /// "Wrapped Aave Monad AUSD", Aave's own ERC-4626 wrapper (AUSD_STATA_TOKEN
    /// in bgd-labs/aave-address-book).
    address constant SAVINGS_VAULT = 0x9e1AcC5BFbf34e2E579763cE14042d957719fE76;

    uint256 constant PAYER_KEY = 0xB0B;

    modifier onMainnet() {
        if (block.chainid != 143) {
            vm.skip(true);
            return;
        }
        _;
    }

    function _fund(address who, uint256 amount) internal {
        vm.prank(AAVE_AUSD);
        IAusdMainnet(AUSD).transfer(who, amount);
    }

    function _digest(address to, uint256 value, uint256 validBefore, bytes32 nonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                IAusdMainnet(AUSD).RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                vm.addr(PAYER_KEY),
                to,
                value,
                uint256(0),
                validBefore,
                nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", IAusdMainnet(AUSD).DOMAIN_SEPARATOR(), structHash));
    }

    function test_mainnet_realAusdAcceptsTheRoutersAuthorization() public onMainnet {
        address payer = vm.addr(PAYER_KEY);
        address recipient = makeAddr("recipient");
        address treasury = makeAddr("treasury");
        EntoleRouter router = new EntoleRouter(AUSD, treasury, 50, 100_000, 2_500_000);

        _fund(payer, 500e6);
        uint256 start = IAusdMainnet(AUSD).balanceOf(payer);

        uint256 amount = 100e6;
        uint256 fee = router.feeFor(amount);
        bytes32 salt = keccak256("mainnet-fork");
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = router.paymentNonce(recipient, amount, fee, salt);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PAYER_KEY, _digest(address(router), amount + fee, validBefore, nonce));

        vm.prank(makeAddr("relayer"));
        router.pay(payer, recipient, amount, 0, validBefore, salt, v, r, s);

        assertEq(IAusdMainnet(AUSD).balanceOf(recipient), amount, "recipient paid");
        assertEq(IAusdMainnet(AUSD).balanceOf(treasury), fee, "treasury paid the fee");
        assertEq(IAusdMainnet(AUSD).balanceOf(payer), start - amount - fee, "payer paid amount + fee, once");
        assertEq(IAusdMainnet(AUSD).balanceOf(address(router)), 0, "router holds nothing");
    }

    function test_mainnet_savingsEarnInAavesVaultAndComeBackOut() public onMainnet {
        ISavingsVault vault = ISavingsVault(SAVINGS_VAULT);
        assertEq(vault.asset(), AUSD, "the vault takes AUSD itself");

        address saver = makeAddr("saver");
        uint256 put = 1_000e6;
        _fund(saver, put);

        // In: the same two steps a person's account takes.
        vm.startPrank(saver);
        IAusdMainnet(AUSD).approve(SAVINGS_VAULT, put);
        uint256 shares = vault.deposit(put, saver);
        vm.stopPrank();

        assertEq(IAusdMainnet(AUSD).balanceOf(saver), 0, "all of it went in");
        assertEq(vault.balanceOf(saver), shares);
        uint256 atStart = vault.convertToAssets(shares);
        assertApproxEqAbs(atStart, put, 2, "nothing is taken on the way in");

        // Thirty days of borrowers paying interest.
        vm.warp(block.timestamp + 30 days);
        uint256 afterMonth = vault.convertToAssets(shares);
        assertGt(afterMonth, atStart, "it is worth more after a month");
        emit log_named_decimal_uint("1,000 AUSD after 30 days", afterMonth, 6);
        emit log_named_uint(
            "annualised, in hundredths of a percent", ((afterMonth - atStart) * 365 * 10_000) / (atStart * 30)
        );

        // Out: one step, all of it, with what it earned.
        assertGe(vault.maxWithdraw(saver), afterMonth - 2, "all of it can be taken out now");
        vm.prank(saver);
        uint256 back = vault.redeem(shares, saver, saver);
        assertEq(IAusdMainnet(AUSD).balanceOf(saver), back);
        assertGt(back, put, "more came back than went in");
        assertEq(vault.balanceOf(saver), 0);
    }
}
