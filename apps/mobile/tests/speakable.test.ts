import { describe, expect, it, vi } from 'vitest';

import { speakable } from '../lib/voice';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

describe('what the voice is given to say', () => {
  it('says its name the way it is said, and only the name', () => {
    expect(speakable('Hi Ngozi. I’m Ayo. Say “Hey Ayo” any time.')).toBe('Hi Ngozi. I’m Eye-yo. Say “Hey Eye-yo” any time.');
    expect(speakable('Ayodele sent you ₦5,000.')).toBe('Ayodele sent you 5,000 naira.');
  });

  it('reads an amount as naira and a username as a name', () => {
    expect(speakable('Sent. ₦12,500 has gone to @ada.')).toBe('Sent. 12,500 naira has gone to ada.');
  });
});
