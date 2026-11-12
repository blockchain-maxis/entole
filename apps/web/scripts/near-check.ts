/**
 * near:check — proves, live, the two things Entole relies on NEAR for.
 *
 *   pnpm --filter @entole/web near:check
 *
 * 1. NEAR AI Cloud's sealed hardware: a fresh nonce, the attestation report,
 *    Intel's verdict on both quotes, the NVIDIA GPU verdict, the binding of
 *    the signing key and nonce, the measured configuration and start-up log.
 *    With NEARAI_API_KEY set it also sends one completion and checks its stamp.
 * 2. NEAR Intents through 1Click: a dry quote from dollars to euros inside an
 *    Intents account (nothing moves; no key needed).
 *
 * Prints each check and exits non-zero if any fails. Reads NEARAI_API_KEY and
 * ONECLICK_API_KEY from the environment (or apps/web/.env.local).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { join } from 'node:path';

import { ASSETS } from '@entole/core/intents-pockets';
import { newNonce, proofLines, summariseProof } from '@entole/core/tee-proof';

import { askSealed, checkAnswers, checkHardware, DEFAULT_STATEMENT_MODEL, NEAR_AI_BASE } from '../lib/server/near-ai';

// Slow networks give each address only 250 ms by default.
setDefaultAutoSelectFamilyAttemptTimeout(8000);

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(join(__dirname, '..', file), 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
    }
  } catch {
    // No such file: the environment alone is used.
  }
}

const ok = (passed: boolean) => (passed ? 'PASS' : 'FAIL');
let failed = false;

async function sealedHardware() {
  const model = process.env.NEARAI_STATEMENT_MODEL?.trim() || DEFAULT_STATEMENT_MODEL;
  const apiKey = process.env.NEARAI_API_KEY?.trim();
  const config = { apiKey: apiKey ?? '', base: NEAR_AI_BASE, statementModel: model, fetch };
  const nonce = newNonce((length) => new Uint8Array(randomBytes(length)));
  console.log(`\nNEAR AI Cloud · ${model} · nonce ${nonce.slice(0, 16)}…`);
  const started = Date.now();
  const hardware = await checkHardware(config, model, nonce);
  for (const check of hardware.checks) console.log(`  ${ok(check.passed)}  ${check.part.padEnd(7)} ${check.id.padEnd(9)} ${check.detail}`);
  console.log(`  (${Date.now() - started} ms)`);

  const checks = [...hardware.checks];
  if (apiKey) {
    const answer = await askSealed(config, {
      model,
      system: 'Answer with JSON only.',
      user: 'Reply {"ok": true}.',
      maxTokens: 400,
    });
    const stamped = await checkAnswers(config, model, [answer], hardware);
    console.log(`  ${ok(stamped.passed)}  answers   ${stamped.detail}`);
    checks.push(stamped);
  } else {
    console.log('  SKIP  answers   set NEARAI_API_KEY to send one completion and check its stamp');
  }
  const summary = summariseProof(checks, model, new Date());
  for (const line of proofLines(summary)) console.log(`        ${line.passed ? '✓' : '✗'} ${line.words}`);
  if (!hardware.checks.every((check) => check.passed)) failed = true;
  if (apiKey && !summary.proven) failed = true;
}

async function intents() {
  console.log('\nNEAR Intents · 1Click dry quote, $5 of USDC → EURe inside an Intents account');
  const account = `0x${'0'.repeat(39)}1`;
  const apiKey = process.env.ONECLICK_API_KEY?.trim();
  const response = await fetch('https://1click.chaindefuser.com/v0/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}) },
    body: JSON.stringify({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 50,
      depositType: 'INTENTS',
      originAsset: ASSETS.nearUsdc,
      destinationAsset: ASSETS.gnosisEure,
      amount: '5000000',
      refundTo: account,
      refundType: 'INTENTS',
      recipient: account,
      recipientType: 'INTENTS',
      deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
  });
  const body = (await response.json()) as { quote?: { amountOutFormatted?: string; timeEstimate?: number } };
  const passed = response.ok && Boolean(body.quote?.amountOutFormatted);
  console.log(`  ${ok(passed)}  $5.00 → €${body.quote?.amountOutFormatted ?? '?'} in about ${body.quote?.timeEstimate ?? '?'} s ${apiKey ? '(partner key)' : '(no partner key: +25 bps)'}`);
  if (!passed) failed = true;
}

async function main() {
  await sealedHardware().catch((error) => {
    failed = true;
    console.log(`  FAIL  ${error instanceof Error ? error.message : String(error)}`);
  });
  await intents().catch((error) => {
    failed = true;
    console.log(`  FAIL  ${error instanceof Error ? error.message : String(error)}`);
  });
  console.log(failed ? '\nSome checks failed.' : '\nEvery check passed.');
  process.exit(failed ? 1 : 0);
}

void main();
