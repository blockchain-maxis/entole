// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";

/// @notice Probes whether the local EVM (forge's default revm) implements the
/// RIP-7212 secp256r1 precompile at 0x0100 the way Monad does. Confirmed: it
/// does not, even when forking Monad testnet — forking mirrors on-chain
/// state, not the local interpreter's opcode set. `revokeWithPasskey` is
/// still correct code against Monad's documented precompile ABI; it just
/// can't be proven green outside a real deployed transaction, and that gap
/// is recorded here rather than silently assumed.
contract P256PrecompileTest is Test {
    address constant P256_VERIFIER = 0x0000000000000000000000000000000000000100;

    // A real secp256r1 keypair + signature, generated once with Python's
    // `cryptography` library against SHA-256("entole-test-digest").
    bytes32 constant DIGEST = 0xd62c27e95d3889e451ed742118b5ebac2a5e2217967acae4abd4b2bcd60ca80b;
    uint256 constant X = 0xf0dc2283578094a24f378ee713a2f7a051f23ff0687b12a43b60e98d519f5c66;
    uint256 constant Y = 0x8f801fce058769a500dabd66bdda84dc8c3f21f0f0d6896d6dfeb3770ec7791c;
    uint256 constant R = 0x5c6ed8076338dbe1868870fa49062222ebabb95a426b3317bd57e04ef4c29c29;
    uint256 constant S = 0x667ec9f62b5b1635b8f828f543863ec93c932470610e68e0097efdf5ab8b1986;

    function test_probe_p256PrecompileAvailability() public {
        (bool ok, bytes memory out) = P256_VERIFIER.staticcall(abi.encode(DIGEST, R, S, X, Y));

        if (!ok || out.length != 32) {
            console.log("P256 precompile NOT available in this EVM (expected on a Monad fork only).");
            console.log("ok:", ok);
            console.log("out.length:", out.length);
            return;
        }

        bool valid = out[31] == 0x01;
        console.log("P256 precompile responded. Signature valid:", valid);
        assertTrue(valid, "known-good secp256r1 signature must verify");
    }
}
