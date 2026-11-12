import { afterEach, describe, expect, it } from 'vitest';

import { modelConfig, NEAR_AI_CHAT_URL, NEAR_AI_KIMI } from '@/lib/server/model';

/** Which model Ayo asks first, and which stands behind it (decided 12 November 2026). */
const KEYS = ['NEARAI_API_KEY', 'KIMI_API_KEY', 'ASSISTANT_MODEL', 'ASSISTANT_API_URL', 'ASSISTANT_FALLBACK_API_KEY', 'ASSISTANT_FALLBACK_API_URL', 'NEARAI_ASSISTANT_MODEL', 'NEARAI_CHAT_URL'];
afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('the assistant\'s model', () => {
  it('is Kimi through NEAR AI Cloud first, with Moonshot direct behind it', () => {
    process.env.NEARAI_API_KEY = 'near';
    process.env.KIMI_API_KEY = 'kimi';
    const config = modelConfig('assistant')!;
    expect(config).toMatchObject({ apiKey: 'near', apiUrl: NEAR_AI_CHAT_URL, model: NEAR_AI_KIMI });
    expect(config.fallback).toMatchObject({ apiKey: 'kimi' });
  });

  it('is Moonshot direct without a NEAR AI key, and off with neither', () => {
    process.env.KIMI_API_KEY = 'kimi';
    expect(modelConfig('assistant')).toMatchObject({ apiKey: 'kimi', fallback: undefined });
    delete process.env.KIMI_API_KEY;
    expect(modelConfig('assistant')).toBeNull();
  });
});
