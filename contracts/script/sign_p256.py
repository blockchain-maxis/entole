#!/usr/bin/env python3
"""Signs a 32-byte digest with a fixed secp256r1 test key, for Foundry's FFI
cheatcode to call from a test. Not for production use — the private key here
is a hardcoded test scalar, not a real passkey.

Usage: sign_p256.py <32-byte-hex-digest>
Prints one 0x-prefixed hex string: x || y || r || s, 32 bytes each,
big-endian, no separators — byte-identical to Solidity's
abi.encode(uint256,uint256,uint256,uint256), so Foundry's `vm.ffi` can
`abi.decode` it directly.
"""
import sys
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, Prehashed

# Fixed test-only scalar. Deterministic so the test suite is reproducible.
TEST_PRIVATE_SCALAR = 0x4E544F4C455F544553545F5031353255534B4559313233343536373839304142

SECP256R1_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551


def hx(v: int) -> str:
    return "0x" + format(v, "064x")


def main():
    digest_hex = sys.argv[1]
    digest = bytes.fromhex(digest_hex[2:] if digest_hex.startswith("0x") else digest_hex)
    assert len(digest) == 32, f"digest must be 32 bytes, got {len(digest)}"

    priv = ec.derive_private_key(TEST_PRIVATE_SCALAR, ec.SECP256R1(), default_backend())
    pub = priv.public_key().public_numbers()

    sig = priv.sign(digest, ec.ECDSA(Prehashed(hashes.SHA256())))
    r, s = decode_dss_signature(sig)
    if s > SECP256R1_ORDER // 2:
        s = SECP256R1_ORDER - s

    print("0x" + format(pub.x, "064x") + format(pub.y, "064x") + format(r, "064x") + format(s, "064x"))


if __name__ == "__main__":
    main()
