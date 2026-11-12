import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hexToBytes } from '@noble/hashes/utils.js';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import {
  attestationSchema,
  checkReport,
  expectedStampText,
  gpuEvidenceFor,
  gpuVerdict,
  newNonce,
  proofLines,
  replayRtmr3,
  stampMatches,
  summariseProof,
  type ProofCheck,
  type QuoteFields,
  type TeeReport,
} from './tee-proof';

/**
 * A real report, fetched from NEAR AI Cloud on 12 November 2026 for
 * `z-ai/glm-5.3-flash` with the nonce stored beside it. Certificates and the
 * GPU evidence list are trimmed; everything the checks read is as sent.
 */
const fixture = JSON.parse(readFileSync(join(__dirname, 'test-data/near-ai-report.json'), 'utf8')) as {
  nonce: string;
} & Record<string, unknown>;
const attestation = attestationSchema.parse(fixture);
const nonce = fixture.nonce;

/**
 * The quote's fields read straight from its bytes (TDX quote v4: 48-byte
 * header, then the TD report body). The server gets these from the verifier
 * after the quote's own signature chain is checked; here they are read raw.
 */
function quoteFieldsOf(report: TeeReport, status = 'UpToDate'): QuoteFields {
  const quote = hexToBytes(report.intel_quote);
  const body = 48;
  return {
    status,
    tdAttributes: quote.slice(body + 120, body + 128),
    mrConfigId: quote.slice(body + 184, body + 232),
    rtMr3: quote.slice(body + 472, body + 520),
    reportData: quote.slice(body + 520, body + 584),
  };
}

const allPassed = (checks: ProofCheck[]) => checks.every((check) => check.passed);

describe('the attestation report', () => {
  it('passes every check for the gateway and the model, as sent', () => {
    const gateway = checkReport(attestation.gateway_attestation, quoteFieldsOf(attestation.gateway_attestation), nonce, 'gateway');
    expect(gateway.filter((check) => !check.passed)).toEqual([]);
    expect(attestation.model_attestations).toHaveLength(1);
    const model = attestation.model_attestations[0]!;
    expect(allPassed(checkReport(model, quoteFieldsOf(model), nonce, 'model'))).toBe(true);
  });

  it('fails freshness for anyone else\'s nonce', () => {
    const other = 'ab'.repeat(32);
    const checks = checkReport(attestation.gateway_attestation, quoteFieldsOf(attestation.gateway_attestation), other, 'gateway');
    expect(checks.find((check) => check.id === 'fresh')?.passed).toBe(false);
  });

  it('fails the binding when the report names a different key', () => {
    const report = { ...attestation.gateway_attestation, signing_address: '0x' + '11'.repeat(20) };
    const checks = checkReport(report, quoteFieldsOf(attestation.gateway_attestation), nonce, 'gateway');
    expect(checks.find((check) => check.id === 'bound')?.passed).toBe(false);
  });

  it('fails the software check when the configuration is changed by one character', () => {
    const report = attestation.gateway_attestation;
    const altered = { ...report, info: { ...report.info, tcb_info: { app_compose: report.info.tcb_info.app_compose + ' ' } } };
    const checks = checkReport(altered, quoteFieldsOf(report), nonce, 'gateway');
    expect(checks.find((check) => check.id === 'software')?.passed).toBe(false);
  });

  it('fails the start-up record when an event is altered', () => {
    const report = attestation.gateway_attestation;
    const events = report.event_log.map((event) => (event.imr === 3 ? { ...event, event_payload: '00' } : event));
    const checks = checkReport({ ...report, event_log: events }, quoteFieldsOf(report), nonce, 'gateway');
    expect(checks.find((check) => check.id === 'events')?.passed).toBe(false);
  });

  it('refuses a platform that is not fully patched, and debug mode', () => {
    const report = attestation.gateway_attestation;
    const fields = quoteFieldsOf(report, 'OutOfDate');
    const debug = { ...fields, status: 'UpToDate', tdAttributes: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]) };
    expect(checkReport(report, fields, nonce, 'gateway').find((check) => check.id === 'hardware')?.passed).toBe(false);
    expect(checkReport(report, debug, nonce, 'gateway').find((check) => check.id === 'not-debug')?.passed).toBe(false);
  });

  it('replays the event log to the quote\'s RTMR3', () => {
    const report = attestation.model_attestations[0]!;
    expect(replayRtmr3(report.event_log)).toEqual(quoteFieldsOf(report).rtMr3);
  });
});

describe('the GPU evidence', () => {
  it('is only sent on when it carries our nonce', () => {
    const model = attestation.model_attestations[0]!;
    expect(gpuEvidenceFor(model, nonce)).not.toBeNull();
    expect(gpuEvidenceFor(model, 'cd'.repeat(32))).toBeNull();
    expect(gpuEvidenceFor(attestation.gateway_attestation, nonce)).toBeNull();
  });

  it('reads NVIDIA\'s verdict from the token', () => {
    const token = (claims: object) =>
      ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
    expect(gpuVerdict([['JWT', token({ 'x-nvidia-overall-att-result': true })]])).toBe(true);
    expect(gpuVerdict([['JWT', token({ 'x-nvidia-overall-att-result': false })]])).toBe(false);
    expect(gpuVerdict([['JWT', token({ 'x-nvidia-overall-att-result': 'true' })]])).toBe(false);
    expect(gpuVerdict({})).toBe(false);
  });
});

describe('an answer\'s stamp', () => {
  const signer = privateKeyToAccount(`0x${'42'.repeat(32)}`);
  const request = new TextEncoder().encode('{"model":"m","messages":[]}');
  const response = new TextEncoder().encode('{"id":"chat-1","choices":[]}');

  it('matches only the exact bytes and a checked model key', async () => {
    const text = expectedStampText('provider_tee', 'm', request, response);
    const stamp = {
      text,
      signature: await signer.signMessage({ message: text }),
      signing_address: signer.address,
      signing_algo: 'ecdsa' as const,
      signature_kind: 'provider_tee' as const,
    };
    const base = { stamp, model: 'm', request, response, recovers: true, checkedGatewayAddress: '0x0' };
    expect(stampMatches({ ...base, checkedModelAddresses: [signer.address] })).toBe(true);
    expect(stampMatches({ ...base, checkedModelAddresses: [] })).toBe(false);
    expect(stampMatches({ ...base, response: new TextEncoder().encode('{}'), checkedModelAddresses: [signer.address] })).toBe(false);
    expect(stampMatches({ ...base, recovers: false, checkedModelAddresses: [signer.address] })).toBe(false);
  });
});

describe('the summary', () => {
  it('is proven only when every kind of check ran and passed', () => {
    const at = new Date('2026-11-12T12:00:00Z');
    const pass = (id: ProofCheck['id']): ProofCheck => ({ id, part: 'model', passed: true, detail: '' });
    const all = (['hardware', 'not-debug', 'fresh', 'bound', 'software', 'events', 'gpu', 'answers'] as const).map(pass);
    expect(summariseProof(all, 'm', at).proven).toBe(true);
    expect(summariseProof(all.slice(1), 'm', at).proven).toBe(false);
    expect(summariseProof([...all, { ...pass('gpu'), passed: false }], 'm', at).proven).toBe(false);
    expect(proofLines(summariseProof(all, 'm', at))).toHaveLength(8);
  });

  it('makes a 64-character nonce', () => {
    expect(newNonce((length) => new Uint8Array(length).fill(7))).toBe('07'.repeat(32));
  });
});
