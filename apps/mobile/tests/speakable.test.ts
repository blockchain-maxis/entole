import { describe, expect, it, vi } from 'vitest';

import { speakable } from '../lib/voice';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

describe('what the voice is given to say', () => {
  it('says its name the way it is said, and only the name', () => {
    expect(speakable('Hi Ngozi. I’m Ayo. Say “Hey Ayo” any time.')).toBe('Hi N-go-zee. I’m Eye-yo. Say “Hey Eye-yo” any time.');
    expect(speakable('Ayodele sent you ₦5,000.')).toBe('Eye-yo-deh-leh sent you 5,000 naira.');
  });

  it('says Nigerian names the way they are said, and leaves the words on screen to the caller', () => {
    expect(speakable('Sent. ₦5,000 has gone to Chukwuemeka Obi.')).toBe('Sent. 5,000 naira has gone to Chook-woo-eh-meh-kah Obi.');
    expect(speakable('Ngozi sent you ₦2,500.')).toBe('N-go-zee sent you 2,500 naira.');
  });

  it('reads an amount as naira and a username as a name', () => {
    expect(speakable('Sent. ₦12,500 has gone to @ada.')).toBe('Sent. 12,500 naira has gone to ada.');
  });
});

describe('with a Nigerian voice', () => {
  it('leaves names to the voice, which knows them, and still says its own name its way', () => {
    expect(speakable('Hi Ngozi. I’m Ayo.', { nigerianVoice: true })).toBe('Hi Ngozi. I’m Eye-yo.');
    expect(speakable('Sent. ₦5,000 has gone to Chukwuemeka Obi.', { nigerianVoice: true })).toBe('Sent. 5,000 naira has gone to Chukwuemeka Obi.');
  });
});
