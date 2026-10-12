'use client';

import { ArrowUp, Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { LogoLoader } from '@/components/LogoLoader';
import { useAssistantTalk } from '@/lib/assistant-talk';

/**
 * Talking to the assistant.
 *
 * The microphone sits in every header beside the assistant's own control,
 * because that corner is where the assistant lives. It opens a sheet: say what
 * you need, or type it. Your words are in ink; what the assistant says back is
 * in its own blue, set the way an allowance is written.
 *
 * It works the app for you. It opens the screen, picks the person, fills in
 * the amount, and then it is out of the way. Confirming is yours.
 */

const EXAMPLES = ['Send 5,000 to Mum for rent', 'What’s my balance?', 'Show how I get paid'];

/** In every header, beside the assistant's control, while the assistant is on. */
export function TalkButton() {
  const { show } = useAssistantTalk();
  return (
    <button
      type="button"
      onClick={show}
      aria-label="Talk to the assistant"
      className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-indigo-wash text-indigo transition-transform hover:scale-105 active:scale-95"
    >
      <Mic size={17} strokeWidth={1.9} aria-hidden />
    </button>
  );
}

/**
 * What the assistant said after it took the person somewhere. It sits in the
 * page under the header, in the flow, and moves the page down for the moment
 * it is there. It never floats over anything: the screen it has just filled in
 * is the thing the person has to be able to read.
 */
export function AssistantLine() {
  const { line, clearLine, show } = useAssistantTalk();

  useEffect(() => {
    if (!line) return;
    const timer = setTimeout(clearLine, 7000);
    return () => clearTimeout(timer);
  }, [line, clearLine]);

  if (!line) return null;
  return (
    <div role="status" className="flex-none px-gutter pb-3">
      <button
        type="button"
        onClick={show}
        className="flex w-full items-start gap-2.5 rounded-control bg-indigo px-4 py-3 text-left active:translate-y-px"
      >
        <Mic size={16} strokeWidth={1.9} aria-hidden className="mt-0.5 flex-none text-paper" />
        <span className="text-pretty font-strong text-ui text-paper">{line}</span>
      </button>
    </div>
  );
}

export function AssistantTalkSheet() {
  const { open, hide, phase, hearing, turns, hears, problem, startListening, stopListening, ask } = useAssistantTalk();
  const [typed, setTyped] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, hearing, phase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);

  if (!open) return null;

  const listening = phase === 'listening';
  const reading = phase === 'reading';

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = typed.trim();
    if (!text || reading) return;
    setTyped('');
    void ask(text);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" tabIndex={-1} aria-label="Close" onClick={hide} className="scrim-fade absolute inset-0 bg-scrim" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="talk-title"
        tabIndex={-1}
        className="sheet-rise relative flex max-h-[86dvh] w-full max-w-[560px] flex-col rounded-t-sheet bg-card px-gutter-lg pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-floating outline-none"
      >
        <div aria-hidden className="mx-auto h-1 w-10 flex-none rounded-pill bg-line" />
        <p id="talk-title" className="mt-4 flex-none font-strong text-note text-indigo">
          The assistant
        </p>

        <div className="mt-2 min-h-[132px] flex-1 overflow-y-auto" aria-live="polite">
          {turns.length === 0 && !hearing ? (
            <>
              <h2 className="font-display text-heading text-ink">What do you need?</h2>
              <ul className="mt-3 border-t border-hairline">
                {EXAMPLES.map((example) => (
                  <li key={example} className="border-b border-hairline">
                    <button
                      type="button"
                      disabled={reading}
                      onClick={() => void ask(example)}
                      className="-mx-2 w-[calc(100%+1rem)] rounded-control px-2 py-3 text-left font-body text-ui text-slate transition-colors hover:bg-press hover:text-ink"
                    >
                      “{example}”
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ol className="flex flex-col gap-3 pb-1">
              {turns.slice(-6).map((turn, index) =>
                turn.from === 'you' ? (
                  <li key={index} className="text-pretty font-body text-ui text-ink">
                    {turn.text}
                  </li>
                ) : (
                  <li key={index} className="text-pretty font-display-plain text-subhead text-indigo">
                    {turn.text}
                  </li>
                ),
              )}
              {hearing ? <li className="text-pretty font-body text-ui text-slate">{hearing}</li> : null}
            </ol>
          )}
          <div ref={end} />
        </div>

        {problem ? (
          <p role="alert" className="mt-2 flex-none text-pretty font-body text-note text-halt">
            {problem}
          </p>
        ) : null}

        <div className="mt-4 flex flex-none items-center gap-3">
          {hears ? (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={reading}
              aria-label={listening ? 'Stop listening' : 'Start talking'}
              aria-pressed={listening}
              className={`relative flex h-14 w-14 flex-none items-center justify-center rounded-pill bg-indigo text-paper transition-transform active:scale-95 disabled:opacity-70 ${
                listening ? 'talk-listening' : ''
              }`}
            >
              {reading ? (
                <LogoLoader size={26} label="Working it out" mono />
              ) : listening ? (
                <Square size={18} strokeWidth={0} fill="currentColor" aria-hidden />
              ) : (
                <Mic size={22} strokeWidth={1.9} aria-hidden />
              )}
            </button>
          ) : null}

          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center rounded-control border-[1.5px] border-line bg-paper pl-4 pr-1.5 focus-within:border-ink">
            <label htmlFor="talk-typed" className="sr-only">
              Type what you need
            </label>
            <input
              id="talk-typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={listening ? 'Listening' : hears ? 'Or type it' : 'Type what you need'}
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="send"
              maxLength={300}
              disabled={listening}
              className="h-12 min-w-0 flex-1 bg-transparent font-body text-ui text-ink outline-none placeholder:text-mist"
            />
            <button
              type="submit"
              disabled={!typed.trim() || reading}
              aria-label="Send to the assistant"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-ink text-paper transition-opacity disabled:opacity-30"
            >
              <ArrowUp size={18} strokeWidth={2} aria-hidden />
            </button>
          </form>
        </div>

        <p className="mt-3 flex-none text-pretty font-body text-note text-slate">
          It opens screens and gets things ready. Anything that moves your money, you confirm yourself.
        </p>
      </div>
    </div>
  );
}
