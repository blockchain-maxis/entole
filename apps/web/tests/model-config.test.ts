import { afterEach, describe, expect, it } from 'vitest';

import { answeredInSealedHardware, modelConfig, NEAR_AI_ASSISTANT_MODEL, NEAR_AI_CHAT_URL } from '@/lib/server/model';

/** Which model Ayo asks first, and which stands behind it (decided 12 November 2026; DeepSeek since 13 November 2026). */
const KEYS = ['NEARAI_API_KEY', 'KIMI_API_KEY', 'ASSISTANT_MODEL', 'ASSISTANT_API_URL', 'ASSISTANT_FALLBACK_API_KEY', 'ASSISTANT_FALLBACK_API_URL', 'NEARAI_ASSISTANT_MODEL', 'NEARAI_CHAT_URL'];
afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('the assistant\'s model', () => {
  it('is DeepSeek on NEAR AI Cloud first, with Moonshot direct Kimi behind it', () => {
    process.env.NEARAI_API_KEY = 'near';
    process.env.KIMI_API_KEY = 'kimi';
    const config = modelConfig('assistant')!;
    expect(config).toMatchObject({ apiKey: 'near', apiUrl: NEAR_AI_CHAT_URL, model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017' });
    expect(NEAR_AI_ASSISTANT_MODEL).toBe('deepseek-ai/DeepSeek-V4.1-Flash-1017');
    // The backup is Moonshot's own service, where thinking can be turned off.
    expect(config.fallback).toMatchObject({ apiKey: 'kimi', apiUrl: undefined });
  });

  it('can still be pointed at another NEAR model', () => {
    process.env.NEARAI_API_KEY = 'near';
    process.env.NEARAI_ASSISTANT_MODEL = 'moonshotai/kimi-k2.6';
    expect(modelConfig('assistant')).toMatchObject({ model: 'moonshotai/kimi-k2.6' });
  });

  it('says "heard in sealed hardware" only of NEAR\'s own sealed model, and never of the backup', () => {
    process.env.NEARAI_API_KEY = 'near';
    process.env.KIMI_API_KEY = 'kimi';
    const config = modelConfig('assistant')!;
    expect(answeredInSealedHardware(config, NEAR_AI_ASSISTANT_MODEL)).toBe(true);
    expect(answeredInSealedHardware(config, 'kimi-k2.6')).toBe(false);
    process.env.NEARAI_ASSISTANT_MODEL = 'moonshotai/kimi-k2.6';
    expect(answeredInSealedHardware(modelConfig('assistant')!, 'moonshotai/kimi-k2.6')).toBe(false);
    delete process.env.NEARAI_API_KEY;
    expect(answeredInSealedHardware(modelConfig('assistant')!, NEAR_AI_ASSISTANT_MODEL)).toBe(false);
  });

  it('is Moonshot direct without a NEAR AI key, and off with neither', () => {
    process.env.KIMI_API_KEY = 'kimi';
    expect(modelConfig('assistant')).toMatchObject({ apiKey: 'kimi', fallback: undefined });
    delete process.env.KIMI_API_KEY;
    expect(modelConfig('assistant')).toBeNull();
  });
});
