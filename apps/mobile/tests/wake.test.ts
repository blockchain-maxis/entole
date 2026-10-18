import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { provideRecognitionForTests, watchForWake } from '../lib/voice';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

type Handler = (event: never) => void;

/** A recogniser that does what the phone's does: sessions that start, say things, and end. */
function fakeRecogniser(options: { granted?: boolean } = {}) {
  const handlers: Record<string, Handler[]> = {};
  const started: unknown[] = [];
  const module = {
    requestPermissionsAsync: async () => ({ granted: options.granted ?? true }),
    start: (config: unknown) => {
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
  const said = (transcript: string, isFinal = true) => emit('result', { isFinal, results: [{ transcript }] });
  return { module: module as never, started, emit, said, stop: module.stop };
}

describe('waiting to be called by name', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    provideRecognitionForTests(undefined);
  });

  it('hands over what was said after the name, and stops listening', async () => {
    const phone = fakeRecogniser();
    provideRecognitionForTests(phone.module);
    const onWake = vi.fn();
    const onTrouble = vi.fn();
    const watch = await watchForWake({ onWake, onTrouble });
    expect(watch).not.toBeNull();

    phone.said('so anyway what time is it');
    expect(onWake).not.toHaveBeenCalled();

    // The name is heard part-way through a sentence: wait for it to be finished.
    phone.said('hey ayo what is my', false);
    expect(onWake).not.toHaveBeenCalled();
    phone.said('hey ayo what is my balance', true);
    expect(onWake).toHaveBeenCalledExactlyOnceWith('what is my balance');
    expect(phone.stop).toHaveBeenCalled();
    expect(onTrouble).not.toHaveBeenCalled();
  });

  it('answers at once to the name alone, with nothing after it', async () => {
    const phone = fakeRecogniser();
    provideRecognitionForTests(phone.module);
    const onWake = vi.fn();
    await watchForWake({ onWake, onTrouble: vi.fn() });
    phone.said('hey ayo', false);
    expect(onWake).toHaveBeenCalledExactlyOnceWith('');
  });

  it('asks the recogniser for the right language, the name as a hint, and runs on and on', async () => {
    const phone = fakeRecogniser();
    provideRecognitionForTests(phone.module);
    await watchForWake({ onWake: vi.fn(), onTrouble: vi.fn() });
    expect(phone.started[0]).toMatchObject({ lang: 'en-NG', continuous: true, interimResults: true });
    expect((phone.started[0] as { contextualStrings: string[] }).contextualStrings).toContain('Ayo');
  });

  it('begins again when a session ends in quiet, as sessions do', async () => {
    const phone = fakeRecogniser();
    provideRecognitionForTests(phone.module);
    await watchForWake({ onWake: vi.fn(), onTrouble: vi.fn() });
    expect(phone.started).toHaveLength(1);
    phone.emit('error', { error: 'no-speech' });
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(300);
    expect(phone.started).toHaveLength(2);
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(300);
    expect(phone.started).toHaveLength(3);
  });

  it('gives up, and says so, when it keeps failing', async () => {
    const phone = fakeRecogniser();
    provideRecognitionForTests(phone.module);
    const onTrouble = vi.fn();
    await watchForWake({ onWake: vi.fn(), onTrouble });
    for (let round = 0; round < 6 && onTrouble.mock.calls.length === 0; round += 1) {
      phone.emit('error', { error: 'network' });
      phone.emit('end');
      await vi.advanceTimersByTimeAsync(3000);
    }
    expect(onTrouble).toHaveBeenCalledExactlyOnceWith('failed');
    const begun = phone.started.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(phone.started).toHaveLength(begun);
  });

  it('says so, and does not start, when the microphone is not allowed', async () => {
    const phone = fakeRecogniser({ granted: false });
    provideRecognitionForTests(phone.module);
    const onTrouble = vi.fn();
    const watch = await watchForWake({ onWake: vi.fn(), onTrouble });
    expect(watch).toBeNull();
    expect(onTrouble).toHaveBeenCalledExactlyOnceWith('not-allowed');
    expect(phone.started).toHaveLength(0);
  });

  it('stops listening for good when asked to, and does not start again', async () => {
    const phone = fakeRecogniser();
    provideRecognitionForTests(phone.module);
    const watch = await watchForWake({ onWake: vi.fn(), onTrouble: vi.fn() });
    watch!.stop();
    phone.emit('end');
    await vi.advanceTimersByTimeAsync(5000);
    expect(phone.started).toHaveLength(1);
  });

  it('does nothing on a build that cannot listen', async () => {
    provideRecognitionForTests(null);
    expect(await watchForWake({ onWake: vi.fn(), onTrouble: vi.fn() })).toBeNull();
  });
});
