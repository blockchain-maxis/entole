import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { panel, text, heading } from '@metamask/snaps-sdk';
import type { Address } from 'viem';

import {
  ENTOLE_POLICY_ADDRESS,
  MONAD_TESTNET_CHAIN_ID_HEX,
  encodeCreateAllowance,
  encodeExecute,
  encodeRevoke,
  type GrantRequest,
} from './policy';
import {
  grantDialogBody,
  grantDialogTitle,
  redeemDialogBody,
  redeemDialogTitle,
  revokeDialogBody,
  revokeDialogTitle,
  approvedFooter,
} from './copy';

/**
 * The MetaMask side of the "one passkey/session, many keys" story Entole's
 * own app tells with Mera (`packages/core/passkey.ts`) — for a MetaMask
 * user instead of a passkey user. Entole's `EntolePolicy` contract already
 * implements the caveat-enforced-delegation shape ERC-7715/7710 describe
 * (owner grants, a session/delegate address can only `execute` within the
 * caveats, revocation is immediate) — this Snap exposes exactly that
 * shape through Snap-native confirmation dialogs and the connected
 * account's own signing, rather than through Entole's passkey flow.
 *
 * Three custom methods, invoked by a dapp via `wallet_invokeSnap`:
 *  - `entole_grantAllowance` — owner grants a scoped permission (ERC-7715
 *    shape: recipients, per-run max, period cap, period, expiry) to a
 *    delegate/session address. Confirmed in a Snap dialog before the
 *    connected account signs the `createAllowance` transaction for real.
 *  - `entole_redeemAllowance` — the ERC-7710 redemption side: spends inside
 *    an already-granted permission by calling `execute`. Still confirmed —
 *    an agent proposing a spend is not the same as it being allowed to
 *    happen without the human seeing it, same principle as Entole's own
 *    assistant-action screen.
 *  - `entole_revokeAllowance` — ends a permission immediately, mirroring
 *    `EntolePolicy.revoke`.
 *
 * VERIFICATION STATUS — read before publishing, see this package's README:
 * the exact `@metamask/delegation-toolkit` ERC-7715/7710 helper APIs
 * (`erc7715ProviderActions`, the toolkit's own `grantPermissions`/
 * `redeemDelegations` call shapes) could not be confirmed against live
 * documentation in this environment — the docs site's code samples are
 * client-rendered and didn't come through a fetch. This file therefore
 * talks to the connected account directly via the standard `ethereum`
 * provider (`eth_sendTransaction` against `EntolePolicy` itself), which is
 * unambiguously correct and needs no unverified SDK surface — it is a
 * *permission*, request/redeem/revoke pattern equivalent in effect to
 * ERC-7715/7710, but does not literally call MetaMask's `wallet_grantPermissions`
 * JSON-RPC method or the delegation-toolkit's redemption helpers. Wiring
 * this onto the literal ERC-7715/7710 RPC surface once those SDK shapes are
 * confirmed against a real MetaMask Flask instance is the one remaining
 * step for a fully spec-literal claim — see README "Status".
 */

type JsonRpcAccount = Address;

async function requestAccount(): Promise<JsonRpcAccount> {
  const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
  const account = accounts[0];
  if (!account) throw new Error('No account connected.');
  return account as Address;
}

async function ensureMonadTestnet(): Promise<void> {
  const chainId = await ethereum.request({ method: 'eth_chainId' });
  if (chainId !== MONAD_TESTNET_CHAIN_ID_HEX) {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: MONAD_TESTNET_CHAIN_ID_HEX }],
    });
  }
}

async function sendToPolicy(data: `0x${string}`): Promise<string> {
  const from = await requestAccount();
  await ensureMonadTestnet();
  const hash = (await ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: ENTOLE_POLICY_ADDRESS, data }],
  })) as string;
  return hash;
}

function daysFromNowLabel(seconds: bigint): string {
  const days = Math.round(Number(seconds) / 86_400);
  if (days <= 1) return 'in about a day';
  if (days < 60) return `in about ${days} days`;
  return `in about ${Math.round(days / 30)} months`;
}

function periodLabel(periodSeconds: bigint): string {
  const days = Math.round(Number(periodSeconds) / 86_400);
  if (days <= 1) return 'a day';
  if (days <= 7) return 'a week';
  if (days <= 31) return 'a month';
  return `${days} days`;
}

export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  switch (request.method) {
    case 'entole_grantAllowance': {
      const req = request.params as unknown as GrantRequest & { amountLabelPerRun: string; amountLabelPeriod: string };

      const confirmed = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: panel([
            heading(grantDialogTitle()),
            text(
              grantDialogBody({
                recipientCount: req.recipients.length,
                perRunMax: req.amountLabelPerRun,
                periodCap: req.amountLabelPeriod,
                periodLabel: periodLabel(req.periodSeconds),
                expiresLabel: daysFromNowLabel(req.expiresAt - BigInt(Math.floor(Date.now() / 1000))),
              }),
            ),
            text(approvedFooter()),
          ]),
        },
      });
      if (!confirmed) return { ok: false, reason: 'declined' };

      const data = encodeCreateAllowance(req);
      const hash = await sendToPolicy(data);
      return { ok: true, hash };
    }

    case 'entole_redeemAllowance': {
      const { allowanceId, recipient, amount, amountLabel } = request.params as {
        allowanceId: string;
        recipient: Address;
        amount: string;
        amountLabel: string;
      };

      const confirmed = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: panel([heading(redeemDialogTitle()), text(redeemDialogBody({ amount: amountLabel }))]),
        },
      });
      if (!confirmed) return { ok: false, reason: 'declined' };

      const data = encodeExecute(allowanceId, recipient, BigInt(amount));
      const hash = await sendToPolicy(data);
      return { ok: true, hash };
    }

    case 'entole_revokeAllowance': {
      const { allowanceId } = request.params as { allowanceId: string };

      const confirmed = await snap.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: panel([heading(revokeDialogTitle()), text(revokeDialogBody())]),
        },
      });
      if (!confirmed) return { ok: false, reason: 'declined' };

      const data = encodeRevoke(allowanceId);
      const hash = await sendToPolicy(data);
      return { ok: true, hash };
    }

    default:
      throw new Error(`Method not found: ${request.method}`);
  }
};
