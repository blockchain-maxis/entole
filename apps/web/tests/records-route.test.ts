import { createSecp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildRecordsMessage, createRecordSync, sealedDigest } from '@entole/core/record-sync';

import { POST } from '@/app/api/records/route';
import { resetRecords } from '@/lib/server/records';
import { resetRateLimits } from '@/lib/server/sponsor';

const owner = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(5) }));
const stranger = toViemAccount(createSecp256k1SigningSession({ privateKey: new Uint8Array(32).fill(6) }));

/** The client, talking to the real route handler instead of the network. */
function routeFetch(): typeof fetch {
  return (async (_url: string, init: RequestInit) =>
    POST(new Request('http://localhost/api/records', { method: 'POST', body: init.body as string, headers: init.headers }))) as unknown as typeof fetch;
}

const client = (account = owner) =>
  createRecordSync({
    baseUrl: '',
    account: account.address,
    sign: (message) => account.signMessage({ message }),
    fetch: routeFetch(),
  });

async function post(body: unknown) {
  return POST(new Request('http://localhost/api/records', { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => {
  resetRecords();
  resetRateLimits();
});

describe('records carried between devices', () => {
  it('what one device sends, another reads back, opened on the device', async () => {
    expect(await client().push('beneficiaries', '[{"id":"b-ada"}]', 1_000)).toBe(true);
    expect(await client().pull()).toEqual({ beneficiaries: { value: '[{"id":"b-ada"}]', at: 1_000 } });
  });

  it('keeps only what it cannot read', async () => {
    await client().push('invoices', '[{"clientName":"Chiamaka Stores"}]', 1_000);
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const signature = await owner.signMessage({
      message: buildRecordsMessage({ account: owner.address, action: 'get', timestampSeconds }),
    });
    const answer = await (await post({ action: 'get', account: owner.address, timestampSeconds, signature })).json();
    expect(JSON.stringify(answer)).not.toContain('Chiamaka');
  });

  it('refuses an older copy, so a request sent twice changes nothing', async () => {
    expect(await client().push('allowances', '[1]', 2_000)).toBe(true);
    expect(await client().push('allowances', '[0]', 1_000)).toBe(false);
    expect(await client().push('allowances', '[1]', 2_000)).toBe(false);
    expect((await client().pull()).allowances?.value).toBe('[1]');
  });

  it('nobody else can read an account’s records, or write them', async () => {
    await client().push('beneficiaries', '[]', 1_000);
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const forged = await stranger.signMessage({
      message: buildRecordsMessage({ account: owner.address, action: 'get', timestampSeconds }),
    });
    expect((await post({ action: 'get', account: owner.address, timestampSeconds, signature: forged })).status).toBe(401);

    const ciphertext = '0xabcdef';
    const wrote = await stranger.signMessage({
      message: buildRecordsMessage({
        account: owner.address,
        action: 'put',
        collection: 'beneficiaries',
        at: 5_000,
        digest: sealedDigest(ciphertext),
        timestampSeconds,
      }),
    });
    const put = await post({
      action: 'put',
      account: owner.address,
      collection: 'beneficiaries',
      at: 5_000,
      ciphertext,
      timestampSeconds,
      signature: wrote,
    });
    expect(put.status).toBe(401);
  });

  it('a signature over one copy cannot store another', async () => {
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const signature = await owner.signMessage({
      message: buildRecordsMessage({
        account: owner.address,
        action: 'put',
        collection: 'beneficiaries',
        at: 5_000,
        digest: sealedDigest('0xaaaa'),
        timestampSeconds,
      }),
    });
    const swapped = await post({
      action: 'put',
      account: owner.address,
      collection: 'beneficiaries',
      at: 5_000,
      ciphertext: '0xbbbb',
      timestampSeconds,
      signature,
    });
    expect(swapped.status).toBe(401);
  });

  it('refuses an old signature, a collection it does not know, and a copy dated far ahead', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3_600;
    const signature = await owner.signMessage({
      message: buildRecordsMessage({ account: owner.address, action: 'get', timestampSeconds: stale }),
    });
    expect((await post({ action: 'get', account: owner.address, timestampSeconds: stale, signature })).status).toBe(422);
    expect(
      (await post({ action: 'put', account: owner.address, collection: 'passwords', at: 1, ciphertext: '0xab', timestampSeconds: 1, signature }))
        .status,
    ).toBe(400);
    expect(await client().push('activity', '[]', Date.now() + 86_400_000)).toBe(false);
  });
});
