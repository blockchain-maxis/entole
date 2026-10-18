import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openEars, provideRecognitionForTests } from '../lib/voice';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

type Handler = (event: never) => void;

/** A recogniser that does what Android's does: partials that repeat the segment so far, finals that close it, sessions that end. */
function fakePhone(options: { granted?: boolean; onDevice?: boolean } = {}) {
  const handlers: Record<string, Handler[]> = {};
  const started: Record<string, unknown>[] = [];
  const module = {
    requestPermissionsAsync: async () => ({ granted: options.granted ?? true }),
    supportsOnDeviceRecognition: () => options.onDevice ?? false,
    start: (config: Record<string, unknown>) => {
      started.push(config);
    },
    stop: vi.fn(),
    addListener: (event: string, listener: Handler) => {
      (handlers[event] ??= []).push(listener);
      return {
        remove: () => {
          handlers[event] = (handlers[event] ?? []).filter((entry) => entry !== listener);
        },
      };
    },
  };
  const emit = (event: string, payload?: unknown) => {
    for (const listener of [...(handlers[event] ?? [])]) listener(payload as never);
  };
  return {
    module: module as never,
    started,
    stop: module.stop,
    emit,
    partial: (transcript: string) => emit('result', { isFinal: false, results: [{ transcript }] }),
    final: (transcript: string) => emit('result', { isFinal: true, results: [{ transcript }] }),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  provideRecognitionForTests(undefined);
});

async function open(phone: ReturnType<typeof fakePhone>) {
  provideRecognitionForTests(phone.module);
  const heard: string[] = [];
  const trouble = vi.fn();
  const ears = await openEars({ onText: (text) => heard.push(text), onTrouble: trouble });
  return { ears: ears!, heard, trouble };
}

describe('the microphone that does not blink', () => {
  it('opens once, for a long listen in the chosen accent, with the name as a hint', async () => {
    const phone = fakePhone();
    await open(phone);
    expect(phone.started).toHaveLength(1);
    expect(phone.started[0]).toMatchObject({ lang: 'en-NG', continuous: true, interimResults: true });
    expect((phone.started[0] as { contextualStrings: string[] }).contextualStrings).toContain('Ayo');
    // It asks the phone to wait longer before deciding a sentence is over.
    expect(phone.started[0]!.androidIntentOptions).toMatchObject({ EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 3000 });
  });

  it('reports everything as one running text, joining the pieces the phone breaks speech into', async () => {
    const phone = fakePhone();
    const { heard } = await open(phone);
    phone.partial('send five');
    phone.partial('send five thousand');
    phone.final('send five thousand');
    // The phone heard a pause and began a new segment; nothing is lost.
    phone.partial('to');
    phone.partial('to Ada');
    expect(heard.at(-1)).toBe('send five thousand to Ada');
    phone.final('to Ada');
    expect(heard.at(-1)).toBe('send five thousand to Ada');
  });

  it('starts a clean buffer on clear(), and does not hear the words it already had twice', async () => {
    const phone = fakePhone();
    const { ears, heard } = await open(phone);
    phone.partial('hey ayo what is');
    ears.clear();
    expect(heard.at(-1)).toBe('');
    // The phone keeps repeating the segment from its start.
    phone.partial('hey ayo what is my balance');
    expect(heard.at(-1)).toBe('my balance');
    phone.final('hey ayo what is my balance');
    expect(heard.at(-1)).toBe('my balance');
    // And the next segment is wholly new.
    phone.partial('and savings');
    expect(heard.at(-1)).toBe('my balance and savings');
  });

  it('begins again straight away when a session ends by itself, with no gap that could be noticed', async () => {
    const phone = fakePhone();
    await open(phone);
    phone.emit('error', { error: 'no-speech' });
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(60);
    expect(phone.started).toHaveLength(2);
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(60);
    expect(phone.started).toHaveLength(3);
  });

  it('keeps what was said across a restart', async () => {
    const phone = fakePhone();
    const { heard } = await open(phone);
    phone.final('send five thousand');
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(60);
    phone.partial('to Ada');
    expect(heard.at(-1)).toBe('send five thousand to Ada');
  });

  it('gives up, and says so, when it keeps failing, and not before', async () => {
    const phone = fakePhone();
    const { trouble } = await open(phone);
    for (let round = 0; round < 4; round += 1) {
      phone.emit('error', { error: 'network' });
      phone.emit('end');
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(trouble).not.toHaveBeenCalled();
    phone.emit('error', { error: 'network' });
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(3000);
    expect(trouble).toHaveBeenCalledExactlyOnceWith('failed');
    const begun = phone.started.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(phone.started).toHaveLength(begun);
  });

  it('asks to stay on the device when it can, and falls back to the network when that language is not installed', async () => {
    const phone = fakePhone({ onDevice: true });
    await open(phone);
    expect(phone.started[0]).toMatchObject({ requiresOnDeviceRecognition: true });
    phone.emit('error', { error: 'language-not-supported' });
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(60);
    expect(phone.started[1]).not.toHaveProperty('requiresOnDeviceRecognition');
  });

  it('says so, and does not open, when the microphone is not allowed', async () => {
    const phone = fakePhone({ granted: false });
    provideRecognitionForTests(phone.module);
    const trouble = vi.fn();
    expect(await openEars({ onText: vi.fn(), onTrouble: trouble })).toBeNull();
    expect(trouble).toHaveBeenCalledExactlyOnceWith('not-allowed');
    expect(phone.started).toHaveLength(0);
  });

  it('says so when the permission is taken away while it is open', async () => {
    const phone = fakePhone();
    const { trouble } = await open(phone);
    phone.emit('error', { error: 'not-allowed' });
    expect(trouble).toHaveBeenCalledExactlyOnceWith('not-allowed');
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(5000);
    expect(phone.started).toHaveLength(1);
  });

  it('closes for good when asked, and does not begin again', async () => {
    const phone = fakePhone();
    const { ears } = await open(phone);
    ears.stop();
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(5000);
    expect(phone.started).toHaveLength(1);
    expect(phone.stop).toHaveBeenCalled();
  });

  it('does nothing on a build that cannot listen', async () => {
    provideRecognitionForTests(null);
    expect(await openEars({ onText: vi.fn(), onTrouble: vi.fn() })).toBeNull();
  });
});
