import { useEffect, useRef } from 'react';

import { makeOffer, voiceSay } from '@/lib/voice-offers';

/**
 * Asks the person a question out loud for as long as this is on screen, and
 * calls `yes` or `no` on their spoken answer. It renders nothing.
 *
 * `yes` is the function the screen's own button calls. This holds no way to
 * send, sign or answer the fingerprint prompt, and a yes spoken after the screen
 * has gone reaches nothing: the question is withdrawn when this unmounts. With
 * the assistant off it does nothing at all.
 *
 * The question is made once per wording. The handlers are read when the answer
 * comes, so a screen that re-renders does not ask again.
 */
export function VoiceOffer({
  say,
  yes,
  no,
  declined,
}: {
  say: string;
  yes: () => void;
  no?: () => void;
  declined?: string;
}) {
  const handlers = useRef({ yes, no });
  useEffect(() => {
    handlers.current = { yes, no };
  });
  const hasNo = Boolean(no);

  useEffect(
    () =>
      makeOffer({
        say,
        yes: () => handlers.current.yes(),
        ...(hasNo ? { no: () => handlers.current.no?.() } : {}),
        ...(declined ? { declined } : {}),
      }),
    [say, declined, hasNo],
  );
  return null;
}

/** Says one thing out loud when it appears, with no answer expected. Renders nothing. */
export function VoiceSay({ text }: { text: string }) {
  useEffect(() => {
    voiceSay(text);
  }, [text]);
  return null;
}
