'use client';

import { useCallback, useEffect, useState } from 'react';

import { useBackend } from '@entole/core/backend';
import { POCKETS, type PocketCurrency } from '@entole/core/intents-pockets';
import { NearClientError, type PocketView } from '@entole/core/near-client';

export type PocketsState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; pockets: PocketView[] };

/** The person's three pockets, read from where they are held. A failed read shows no figure. */
export function usePockets(): PocketsState & { reload: () => void } {
  const { near } = useBackend();
  const [state, setState] = useState<PocketsState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const pockets = await near.pockets();
      setState({ status: 'ready', pockets });
    } catch (error) {
      setState({ status: 'failed', message: messageOf(error) });
    }
  }, [near]);

  useEffect(() => {
    let live = true;
    void near
      .pockets()
      .then((pockets) => live && setState({ status: 'ready', pockets }))
      .catch((error: unknown) => live && setState({ status: 'failed', message: messageOf(error) }));
    return () => {
      live = false;
    };
  }, [near]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    void load();
  }, [load]);

  return { ...state, reload };
}

/** Plain copy for any failure: the client's own words, or a calm fallback. */
export function messageOf(error: unknown): string {
  if (error instanceof NearClientError) return error.message;
  if (error instanceof Error && error.name === 'MovementNotConfirmedError') return error.message;
  return 'Something went wrong. Nothing has changed. Try again.';
}

export function signOf(currency: PocketCurrency): string {
  return POCKETS.find((pocket) => pocket.currency === currency)?.sign ?? '$';
}
