import type { Address, Hex } from 'viem';
import { encodeFunctionData, keccak256, toHex } from 'viem';

/**
 * Minimal, standalone mirror of `EntolePolicy.sol`'s ABI — just the three
 * functions this Snap calls. Deliberately NOT imported from
 * `@entole/core/onchain-gateway`: a Snap runs in a restricted SES bundle and
 * should stay small and self-contained rather than pulling in `@category-labs/mera`,
 * `zod` and a `react` peer dependency it will never use. If the contract's
 * ABI drifts from `contracts/src/EntolePolicy.sol`, keep this in sync by
 * hand — there are only three functions here.
 */
export const ENTOLE_POLICY_ABI = [
  {
    type: 'function',
    name: 'createAllowance',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'delegate', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'perRunMax', type: 'uint256' },
      { name: 'periodCap', type: 'uint256' },
      { name: 'periodSeconds', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
] as const;

/** Monad testnet — see contracts/README.md. */
export const MONAD_TESTNET_CHAIN_ID_HEX = '0x279f'; // 10143
export const ENTOLE_POLICY_ADDRESS: Address = '0xd0c1099827e49C07f264927d0Dd3416eb29EA9b7';
export const SETTLEMENT_TOKEN_ADDRESS: Address = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';

/** Same deterministic id scheme `packages/core/onchain-gateway.ts` uses, so
 * an allowance created here and one created through Entole's own app can
 * address the same on-chain id if they ever need to agree on one. */
export function toChainAllowanceId(appId: string): Hex {
  return keccak256(toHex(appId));
}

export type GrantRequest = {
  id: string;
  delegate: Address;
  recipients: Address[];
  perRunMax: bigint;
  periodCap: bigint;
  periodSeconds: bigint;
  expiresAt: bigint;
};

export function encodeCreateAllowance(req: GrantRequest, token: Address = SETTLEMENT_TOKEN_ADDRESS): Hex {
  return encodeFunctionData({
    abi: ENTOLE_POLICY_ABI,
    functionName: 'createAllowance',
    args: [
      toChainAllowanceId(req.id),
      req.delegate,
      token,
      req.recipients,
      req.perRunMax,
      req.periodCap,
      req.periodSeconds,
      req.expiresAt,
    ],
  });
}

export function encodeExecute(allowanceAppId: string, recipient: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: ENTOLE_POLICY_ABI,
    functionName: 'execute',
    args: [toChainAllowanceId(allowanceAppId), recipient, amount],
  });
}

export function encodeRevoke(allowanceAppId: string): Hex {
  return encodeFunctionData({
    abi: ENTOLE_POLICY_ABI,
    functionName: 'revoke',
    args: [toChainAllowanceId(allowanceAppId)],
  });
}
