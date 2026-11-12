import { sha256, sha384 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

/**
 * Proof that a statement was read inside sealed hardware (a TEE) on NEAR AI
 * Cloud, checked by us rather than taken on trust.
 *
 * The rules come from NEAR AI's verification reference, read on 12 November
 * 2026 (docs.near.ai/cloud/verification/reference/quote-nonce-signer and
 * .../cloud-api/response-signatures):
 *
 * 1. We make a fresh 32-byte nonce and ask for the attestation report with it.
 * 2. The Intel TDX quote is verified with Intel's collateral (done on the
 *    server with `@phala/dcap-qvl`, which hands back the quote's fields).
 * 3. The quote's 64-byte report data must be the signing address, zero-padded
 *    to 32 bytes, followed by our nonce. So the key that later stamps each
 *    answer lives in that hardware, and the report was made for us, now.
 * 4. MRCONFIGID must be `01 || sha256(app_compose) || 15 zero bytes`: the
 *    software inside is the configuration published in the report.
 * 5. Replaying the RTMR3 event log must give the quote's RTMR3.
 * 6. The GPU evidence carries our nonce and NVIDIA's service says it passes.
 * 7. Each answer's stamp is fetched afterwards and must recover to the signing
 *    address of a report checked in steps 1-6, over
 *    `<model>:<sha256(request bytes)>:<sha256(response bytes)>`.
 *
 * Everything here is pure: no network, no platform. The server does the
 * fetching and the quote verification, and passes the results in.
 */

export const NONCE_BYTES = 32;

/** A fresh nonce as 64 hex characters. `random` is injected for tests. */
export function newNonce(random: (length: number) => Uint8Array): string {
  const bytes = random(NONCE_BYTES);
  if (bytes.length !== NONCE_BYTES) throw new Error('nonce must be 32 bytes');
  return bytesToHex(bytes);
}

const hexString = z.string().regex(/^(0x)?[0-9a-fA-F]*$/);

const eventSchema = z.object({
  imr: z.number().int(),
  event_type: z.number().int().nonnegative(),
  digest: z.string().optional().nullable(),
  event: z.string(),
  event_payload: z.string().optional().nullable(),
});
export type MeasuredEvent = z.infer<typeof eventSchema>;

/** The gateway sends some fields as JSON text and the model reports as JSON. */
const jsonOrText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' ? JSON.parse(value) : value), schema);

export const teeReportSchema = z.object({
  signing_address: z.string(),
  signing_algo: z.enum(['ecdsa', 'ed25519']),
  intel_quote: hexString,
  request_nonce: z.string(),
  event_log: jsonOrText(z.array(eventSchema)),
  info: z.object({
    tcb_info: jsonOrText(z.object({ app_compose: z.string() }).passthrough()),
  }).passthrough(),
  nvidia_payload: z.string().optional(),
  model_name: z.string().optional(),
  tls_cert_fingerprint: z.string().optional().nullable(),
}).passthrough();
export type TeeReport = z.infer<typeof teeReportSchema>;

export const attestationSchema = z.object({
  gateway_attestation: teeReportSchema,
  model_attestations: z.array(teeReportSchema).default([]),
}).passthrough();
export type Attestation = z.infer<typeof attestationSchema>;

/** The fields of a TDX quote that the checks read, as the verifier returns them. */
export type QuoteFields = {
  status: string;
  reportData: Uint8Array;
  mrConfigId: Uint8Array;
  rtMr3: Uint8Array;
  tdAttributes: Uint8Array;
};

/** Only a quote whose platform is fully patched is accepted. */
export const ACCEPTED_TCB_STATUSES: readonly string[] = ['UpToDate'];

export type ProofCheckId =
  | 'hardware'
  | 'not-debug'
  | 'fresh'
  | 'bound'
  | 'software'
  | 'events'
  | 'gpu'
  | 'answers';

export type ProofCheck = {
  id: ProofCheckId;
  /** Which report the check was run on: the gateway or the model. */
  part: 'gateway' | 'model' | 'answers';
  passed: boolean;
  /** For logs and the proof panel's detail line; never a secret. */
  detail: string;
};

const strip0x = (hex: string) => hex.replace(/^0x/i, '');
const fromHex = (hex: string) => hexToBytes(strip0x(hex).toLowerCase());
const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/**
 * RTMR3 as the event log says it should be. Throws when an event's own digest
 * does not match what it hashes to, since that event has been altered.
 */
export function replayRtmr3(events: readonly MeasuredEvent[]): Uint8Array {
  let rtmr3: Uint8Array = new Uint8Array(48);
  const colon = utf8ToBytes(':');
  for (const event of events) {
    if (event.imr !== 3) continue;
    const digest = sha384(
      concatBytes(u32le(event.event_type), colon, utf8ToBytes(event.event), colon, fromHex(event.event_payload ?? '')),
    );
    if (event.digest && !equalBytes(fromHex(event.digest), digest)) {
      throw new Error(`event ${event.event} does not match its digest`);
    }
    rtmr3 = sha384(concatBytes(rtmr3, digest));
  }
  return rtmr3;
}

/** The 32 bytes that bind the signing identity, without TLS binding. */
export function boundIdentity(report: Pick<TeeReport, 'signing_address' | 'signing_algo' | 'tls_cert_fingerprint'>): Uint8Array {
  const identity = fromHex(report.signing_address);
  const expected = report.signing_algo === 'ecdsa' ? 20 : 32;
  if (identity.length !== expected) throw new Error('signing identity has the wrong length');
  if (report.tls_cert_fingerprint) return sha256(concatBytes(identity, fromHex(report.tls_cert_fingerprint)));
  const padded = new Uint8Array(32);
  padded.set(identity);
  return padded;
}

export function expectedConfigId(appCompose: string): Uint8Array {
  return concatBytes(new Uint8Array([1]), sha256(utf8ToBytes(appCompose)), new Uint8Array(15));
}

/**
 * Every check that can be made from a report and its verified quote. The
 * caller has already verified the quote itself; `quote.status` is what the
 * verifier said about the platform.
 */
export function checkReport(
  report: TeeReport,
  quote: QuoteFields,
  nonce: string,
  part: 'gateway' | 'model',
): ProofCheck[] {
  const checks: ProofCheck[] = [];
  const add = (id: ProofCheckId, passed: boolean, detail: string) => checks.push({ id, part, passed, detail });

  add('hardware', ACCEPTED_TCB_STATUSES.includes(quote.status), `platform status ${quote.status}`);
  add('not-debug', ((quote.tdAttributes[0] ?? 1) & 1) === 0, 'debug mode off');

  const nonceBytes = fromHex(nonce);
  const echoed = report.request_nonce.toLowerCase() === nonce.toLowerCase();
  let bound = false;
  let freshInQuote = false;
  try {
    const identity = boundIdentity(report);
    freshInQuote = quote.reportData.length === 64 && equalBytes(quote.reportData.slice(32), nonceBytes);
    bound = quote.reportData.length === 64 && equalBytes(quote.reportData.slice(0, 32), identity);
  } catch {
    bound = false;
  }
  add('fresh', echoed && freshInQuote, 'made for this request');
  add('bound', bound, `key ${report.signing_address.toLowerCase()} held in the hardware`);

  add('software', equalBytes(quote.mrConfigId, expectedConfigId(report.info.tcb_info.app_compose)), 'configuration matches');

  let eventsMatch = false;
  try {
    eventsMatch = equalBytes(replayRtmr3(report.event_log), quote.rtMr3);
  } catch {
    eventsMatch = false;
  }
  add('events', eventsMatch, 'start-up record matches');
  return checks;
}

/** The GPU evidence must carry our nonce before it is worth sending to NVIDIA. */
export function gpuEvidenceFor(report: TeeReport, nonce: string): unknown | null {
  if (!report.nvidia_payload) return null;
  try {
    const payload = JSON.parse(report.nvidia_payload) as { nonce?: unknown };
    if (typeof payload.nonce !== 'string' || payload.nonce.toLowerCase() !== nonce.toLowerCase()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** NVIDIA's answer: `[["JWT", "<token>"], ...]`; the token's claim must be true. */
export function gpuVerdict(nrasAnswer: unknown): boolean {
  if (!Array.isArray(nrasAnswer)) return false;
  const first = nrasAnswer[0];
  if (!Array.isArray(first) || first[0] !== 'JWT' || typeof first[1] !== 'string') return false;
  const body = first[1].split('.')[1];
  if (!body) return false;
  try {
    const json = JSON.parse(base64UrlToText(body)) as Record<string, unknown>;
    return json['x-nvidia-overall-att-result'] === true;
  } catch {
    return false;
  }
}

function base64UrlToText(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export const answerStampSchema = z.object({
  text: z.string(),
  signature: z.string(),
  signing_address: z.string(),
  signing_algo: z.enum(['ecdsa', 'ed25519']),
  signature_kind: z.enum(['provider_tee', 'gateway']).optional(),
});
export type AnswerStamp = z.infer<typeof answerStampSchema>;

/** What an answer's stamp must say, from the exact bytes sent and received. */
export function expectedStampText(
  kind: 'provider_tee' | 'gateway',
  model: string,
  request: Uint8Array,
  response: Uint8Array,
): string {
  const requestHash = bytesToHex(sha256(request));
  const responseHash = bytesToHex(sha256(response));
  return kind === 'provider_tee' ? `${model}:${requestHash}:${responseHash}` : `${requestHash}:${responseHash}`;
}

/**
 * Whether a stamp belongs to the answer and to hardware already checked. The
 * recovery of the signer from `signature` is done by the caller (viem's
 * `verifyMessage`), and passed in as `recovers`.
 */
export function stampMatches(input: {
  stamp: AnswerStamp;
  model: string;
  request: Uint8Array;
  response: Uint8Array;
  recovers: boolean;
  checkedModelAddresses: readonly string[];
  checkedGatewayAddress: string;
}): boolean {
  const { stamp } = input;
  if (stamp.signing_algo !== 'ecdsa' || !stamp.signature_kind || !input.recovers) return false;
  if (stamp.text !== expectedStampText(stamp.signature_kind, input.model, input.request, input.response)) return false;
  const signer = stamp.signing_address.toLowerCase();
  if (stamp.signature_kind === 'gateway') return signer === input.checkedGatewayAddress.toLowerCase();
  return input.checkedModelAddresses.filter((address) => address.toLowerCase() === signer).length === 1;
}

export const proofSummarySchema = z.object({
  proven: z.boolean(),
  checks: z.array(z.object({
    id: z.enum(['hardware', 'not-debug', 'fresh', 'bound', 'software', 'events', 'gpu', 'answers']),
    part: z.enum(['gateway', 'model', 'answers']),
    passed: z.boolean(),
    detail: z.string(),
  })),
  model: z.string(),
  checkedAt: z.string(),
});

export type ProofSummary = {
  /** Every check ran and passed. Anything less is shown as not proven. */
  proven: boolean;
  checks: ProofCheck[];
  model: string;
  checkedAt: string;
};

export function summariseProof(checks: ProofCheck[], model: string, checkedAt: Date): ProofSummary {
  const required: ProofCheckId[] = ['hardware', 'not-debug', 'fresh', 'bound', 'software', 'events', 'gpu', 'answers'];
  const proven = required.every((id) => checks.some((check) => check.id === id && check.passed))
    && checks.every((check) => check.passed);
  return { proven, checks, model, checkedAt: checkedAt.toISOString() };
}

/** Plain words for each check, for the proof panel. No forbidden words. */
export const PROOF_CHECK_WORDS: Record<ProofCheckId, string> = {
  hardware: 'Sealed hardware confirmed with Intel',
  'not-debug': 'Nobody can look inside while it runs',
  fresh: 'Proof made just now, for this reading',
  bound: 'The stamping key lives inside that hardware',
  software: 'The software inside is the published one',
  events: 'Its start-up record is intact',
  gpu: 'The graphics card is sealed too, confirmed by NVIDIA',
  answers: 'Every answer carries that hardware\'s stamp',
};

/** The proof checks merged into one line per kind, for the panel. */
export function proofLines(summary: ProofSummary): { id: ProofCheckId; words: string; passed: boolean }[] {
  const order = Object.keys(PROOF_CHECK_WORDS) as ProofCheckId[];
  return order
    .filter((id) => summary.checks.some((check) => check.id === id))
    .map((id) => ({
      id,
      words: PROOF_CHECK_WORDS[id],
      passed: summary.checks.filter((check) => check.id === id).every((check) => check.passed),
    }));
}
