import { getCollateralAndVerify } from '@phala/dcap-qvl';
import { verifyMessage, type Hex } from 'viem';
import { z } from 'zod';

import {
  answerStampSchema,
  attestationSchema,
  checkReport,
  gpuEvidenceFor,
  gpuVerdict,
  stampMatches,
  type ProofCheck,
  type QuoteFields,
  type TeeReport,
} from '@entole/core/tee-proof';

/**
 * NEAR AI Cloud, server side: a model running in sealed hardware, and the
 * checks that prove it (see `packages/core/tee-proof.ts` for the rules).
 *
 * The order matters and follows NEAR AI's own guidance: the hardware is
 * checked first, with a fresh nonce, and only then is anything sent to it.
 * Each answer is then fetched with the exact bytes sent and received kept, so
 * its stamp can be checked against the hardware already checked.
 *
 * Nothing that passes through here is stored or logged: not the request, not
 * the answer. Only counts and timings leave this file.
 */

export const NEAR_AI_BASE = 'https://cloud-api.near.ai/v1';
// Runs in NEAR's own sealed hardware and answers without a thinking step:
// about 21 s for 20 lines where GLM 5.3 Flash took 62 s (measured 13 Nov 2026).
export const DEFAULT_STATEMENT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
const NRAS_URL = 'https://nras.attestation.nvidia.com/v3/attest/gpu';

export type NearAiConfig = { apiKey: string; base: string; statementModel: string; fetch: typeof fetch };

export function nearAiConfig(): NearAiConfig | null {
  const apiKey = process.env.NEARAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    base: (process.env.NEARAI_API_BASE?.trim() || NEAR_AI_BASE).replace(/\/$/, ''),
    statementModel: process.env.NEARAI_STATEMENT_MODEL?.trim() || DEFAULT_STATEMENT_MODEL,
    fetch,
  };
}

// ------------------------------------------------------------- the hardware

export type CheckedHardware = {
  checks: ProofCheck[];
  gatewayAddress: string;
  /** Signing addresses of every model report that passed every check. */
  modelAddresses: string[];
};

type QuoteVerifier = (quote: Uint8Array) => Promise<QuoteFields>;

/** Intel's verdict on a quote, through `@phala/dcap-qvl` and its collateral service. */
export const verifyQuote: QuoteVerifier = async (quote) => {
  const verified = await getCollateralAndVerify(quote);
  const report = verified.report.asTd10() ?? verified.report.asTd15()?.base;
  if (!report) throw new Error('not a TDX quote');
  return {
    status: verified.status,
    reportData: report.reportData,
    mrConfigId: report.mrConfigId,
    rtMr3: report.rtMr3,
    tdAttributes: report.tdAttributes,
  };
};

const hex = (value: string) => Uint8Array.from(Buffer.from(value.replace(/^0x/i, ''), 'hex'));

async function checkOne(report: TeeReport, nonce: string, part: 'gateway' | 'model', verify: QuoteVerifier): Promise<ProofCheck[]> {
  try {
    return checkReport(report, await verify(hex(report.intel_quote)), nonce, part);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 120) : 'quote not verified';
    return [{ id: 'hardware', part, passed: false, detail }];
  }
}

async function checkGpu(report: TeeReport, nonce: string, doFetch: typeof fetch): Promise<ProofCheck> {
  const evidence = gpuEvidenceFor(report, nonce);
  if (!evidence) return { id: 'gpu', part: 'model', passed: false, detail: 'no GPU evidence for this request' };
  try {
    const response = await doFetch(NRAS_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(evidence),
    });
    const passed = response.ok && gpuVerdict(await response.json());
    return { id: 'gpu', part: 'model', passed, detail: passed ? 'NVIDIA confirmed' : `NVIDIA said no (${response.status})` };
  } catch {
    return { id: 'gpu', part: 'model', passed: false, detail: 'NVIDIA could not be reached' };
  }
}

/** Every check on the gateway and the model's hardware, made for this nonce. */
export async function checkHardware(
  config: Pick<NearAiConfig, 'base' | 'fetch'>,
  model: string,
  nonce: string,
  verify: QuoteVerifier = verifyQuote,
): Promise<CheckedHardware> {
  const url = `${config.base}/attestation/report?${new URLSearchParams({ model, provider: 'near', signing_algo: 'ecdsa', nonce })}`;
  const response = await config.fetch(url, { headers: { 'x-no-aliasing': 'true', accept: 'application/json' } });
  if (!response.ok) throw new Error(`attestation report ${response.status}`);
  const attestation = attestationSchema.parse(await response.json());
  const models = attestation.model_attestations.filter((report) => !report.model_name || report.model_name === model);
  if (!models.length) throw new Error('no model evidence');

  const [gateway, ...perModel] = await Promise.all([
    checkOne(attestation.gateway_attestation, nonce, 'gateway', verify),
    ...models.map(async (report) => [...(await checkOne(report, nonce, 'model', verify)), await checkGpu(report, nonce, config.fetch)]),
  ]);
  const modelAddresses = models
    .filter((_, index) => perModel[index]!.every((check) => check.passed))
    .map((report) => report.signing_address.toLowerCase());
  return {
    checks: [...gateway!, ...perModel.flat()],
    gatewayAddress: gateway!.every((check) => check.passed) ? attestation.gateway_attestation.signing_address.toLowerCase() : '',
    modelAddresses,
  };
}

// ---------------------------------------------------------------- answers

export type SealedAnswer = { id: string; content: string; request: Uint8Array; response: Uint8Array };

const completionSchema = z.object({
  id: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

export class SealedModelError extends Error {
  constructor(readonly status: number) {
    super(`NEAR AI ${status}`);
  }
}

/**
 * One completion, with the exact bytes kept. The canonical model id and
 * `x-no-aliasing` keep the stamp the model's own; no streaming, so the gateway
 * does not re-sign; `identity` encoding so the bytes hashed are the bytes sent.
 */
export async function askSealed(
  config: NearAiConfig,
  input: { model: string; system: string; user: string; maxTokens: number; signal?: AbortSignal },
): Promise<SealedAnswer> {
  const body = JSON.stringify({
    model: input.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: input.maxTokens,
    stream: false,
  });
  const request = new TextEncoder().encode(body);
  const response = await config.fetch(`${config.base}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-encoding': 'identity',
      'x-no-aliasing': 'true',
    },
    body: request,
    signal: input.signal,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw new SealedModelError(response.status);
  const parsed = completionSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  return { id: parsed.id, content: parsed.choices[0]!.message.content ?? '', request, response: bytes };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An answer's stamp, which can take a moment to be recorded. */
async function fetchStamp(config: NearAiConfig, id: string): Promise<z.infer<typeof answerStampSchema> | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await config.fetch(`${config.base}/signature/${encodeURIComponent(id)}?signing_algo=ecdsa`, {
      headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' },
    });
    if (response.ok) {
      const parsed = answerStampSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    }
    if (response.status !== 404) return null;
    await sleep(500 * (attempt + 1));
  }
  return null;
}

/** One `answers` check: every answer carries a stamp from hardware already checked. */
export async function checkAnswers(config: NearAiConfig, model: string, answers: readonly SealedAnswer[], hardware: CheckedHardware): Promise<ProofCheck> {
  if (!answers.length) return { id: 'answers', part: 'answers', passed: false, detail: 'no answers' };
  const results = await Promise.all(answers.map(async (answer) => {
    const stamp = await fetchStamp(config, answer.id);
    if (!stamp) return false;
    const recovers = stamp.signing_algo === 'ecdsa'
      && await verifyMessage({ address: stamp.signing_address as Hex, message: stamp.text, signature: stamp.signature as Hex }).catch(() => false);
    return stampMatches({
      stamp,
      model,
      request: answer.request,
      response: answer.response,
      recovers,
      checkedModelAddresses: hardware.modelAddresses,
      checkedGatewayAddress: hardware.gatewayAddress,
    });
  }));
  const good = results.filter(Boolean).length;
  return { id: 'answers', part: 'answers', passed: good === answers.length, detail: `${good} of ${answers.length} answers stamped` };
}
