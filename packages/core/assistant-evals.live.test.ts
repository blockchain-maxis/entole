import { describe, expect, it } from 'vitest';

import { readWithModel } from './assistant-brain';
import { ASSISTANT_EVALS, scoreReply, summarise, type EvalVerdict } from './assistant-evals';

/**
 * The live model, asked every case in `assistant-evals.ts` and scored. Opt in,
 * so it never runs in CI or by accident (it takes minutes and spends the key):
 *
 *   RUN_LIVE_EVALS=1 KIMI_API_KEY=… pnpm --filter @entole/core exec vitest run assistant-evals.live
 *
 * - `EVAL_RPM` (default 3, the Moonshot account's cap on 11 November 2026)
 *   paces the asks so the cap is not what is measured.
 * - `EVAL_MIN` (default 0.9) is the share of answered cases that must pass.
 * - `ASSISTANT_MODEL` / `ASSISTANT_API_URL` score another model the same way.
 *
 * It prints the score by area and every failure. A case the model was too
 * busy to answer is counted apart: it says nothing about understanding.
 */
const apiKey = process.env.KIMI_API_KEY?.trim();
const run = process.env.RUN_LIVE_EVALS === '1' && Boolean(apiKey);
const perMinute = Number(process.env.EVAL_RPM) > 0 ? Number(process.env.EVAL_RPM) : 3;
const minimum = Number(process.env.EVAL_MIN) > 0 ? Number(process.env.EVAL_MIN) : 0.9;

describe.skipIf(!run)('the live model against the eval set', () => {
  it(
    'understands enough of what people really say',
    async () => {
      const config = {
        apiKey: apiKey ?? '',
        model: process.env.ASSISTANT_MODEL?.trim() || undefined,
        apiUrl: process.env.ASSISTANT_API_URL?.trim() || undefined,
        agent: 'eval' as const,
      };
      const gap = Math.ceil(60_000 / perMinute);
      const results: { item: (typeof ASSISTANT_EVALS)[number]; verdict: EvalVerdict | 'busy' }[] = [];

      for (const item of ASSISTANT_EVALS) {
        const started = Date.now();
        const read = await readWithModel(item.text, config);
        const verdict = read.ok ? scoreReply(item, read.reply) : read.why === 'busy' ? 'busy' : scoreReply(item, null);
        results.push({ item, verdict });
        console.log(
          JSON.stringify({ text: item.text, ms: Date.now() - started, verdict, ...(read.ok ? { reply: read.reply } : { read }) }),
        );
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, gap - (Date.now() - started))));
      }

      const report = summarise(results);
      console.log(JSON.stringify({ model: config.model ?? 'default', ...report }, null, 2));
      expect(report.total, 'the model answered too few cases to score').toBeGreaterThanOrEqual(ASSISTANT_EVALS.length * 0.8);
      expect(report.passed / report.total).toBeGreaterThanOrEqual(minimum);
    },
    ASSISTANT_EVALS.length * (60_000 / perMinute + 15_000),
  );
});
