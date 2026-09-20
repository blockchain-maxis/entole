// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EntoleRouter} from "../src/EntoleRouter.sol";

interface IAusd {
    function balanceOf(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
}

interface IAgoraFaucet {
    function requestFunds(address to) external;
}

/// @notice Runs the router against the REAL Agora AUSD on Monad testnet, so the
/// signature format (EIP-712 domain, typehash, `to == msg.sender`) is proven
/// against the deployed token, not a mock. Skipped unless forked:
///   forge test --fork-url monad_testnet --match-contract EntoleRouterFork
contract EntoleRouterForkTest is Test {
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant AGORA_FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;

    uint256 constant PAYER_KEY = 0xB0B;

    /// The EIP-712 digest AUSD verifies for `ReceiveWithAuthorization`.
    function _digest(address to, uint256 value, uint256 validBefore, bytes32 nonce) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                IAusd(AUSD).RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                vm.addr(PAYER_KEY),
                to,
                value,
                uint256(0),
                validBefore,
                nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", IAusd(AUSD).DOMAIN_SEPARATOR(), structHash));
    }

    /// Signs the payer's one authorization exactly as the app will.
    function _sign(EntoleRouter router, address recipient, uint256 amount, bytes32 salt, uint256 validBefore)
        internal
        view
        returns (uint8, bytes32, bytes32)
    {
        uint256 fee = router.feeFor(amount);
        bytes32 nonce = router.paymentNonce(recipient, amount, fee, salt);
        return vm.sign(PAYER_KEY, _digest(address(router), amount + fee, validBefore, nonce));
    }

    function test_fork_realAusdAcceptsTheRoutersAuthorization() public {
        if (block.chainid != 10143) {
            vm.skip(true);
            return;
        }

        address payer = vm.addr(PAYER_KEY);
        address recipient = makeAddr("recipient");
        address treasury = makeAddr("treasury");

        EntoleRouter router = new EntoleRouter(AUSD, treasury, 50, 100_000, 2_500_000);

        // Fund the payer from Agora's own faucet (10,000 AUSD).
        IAgoraFaucet(AGORA_FAUCET).requestFunds(payer);
        uint256 start = IAusd(AUSD).balanceOf(payer);
        assertGt(start, 1_000e6, "faucet funded the payer");

        uint256 amount = 100e6;
        uint256 fee = router.feeFor(amount);
        bytes32 salt = keccak256("fork-test");
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(router, recipient, amount, salt, validBefore);

        vm.prank(makeAddr("relayer"));
        router.pay(payer, recipient, amount, 0, validBefore, salt, v, r, s);

        assertEq(IAusd(AUSD).balanceOf(recipient), amount, "recipient paid");
        assertEq(IAusd(AUSD).balanceOf(treasury), fee, "treasury paid the fee");
        assertEq(IAusd(AUSD).balanceOf(payer), start - amount - fee, "payer paid amount + fee, once");
        assertEq(IAusd(AUSD).balanceOf(address(router)), 0, "router holds nothing");
    }
}
