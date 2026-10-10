/**
 * What a person can send in from an app they already use. Each is named the
 * way that other app names it, because that is the only place the words are
 * needed: here the person is telling us what they hold somewhere else.
 *
 * Safe for a client bundle: names only. How each one is turned into the
 * account's own money lives in `onramp.ts`, on the server.
 */
export const DEPOSIT_SOURCES = [
  { id: 'monad-ausd', asset: 'AUSD', place: 'Monad' },
  { id: 'monad-usdc', asset: 'USDC', place: 'Monad' },
  { id: 'monad-mon', asset: 'MON', place: 'Monad' },
  { id: 'base-usdc', asset: 'USDC', place: 'Base' },
  { id: 'arbitrum-usdc', asset: 'USDC', place: 'Arbitrum' },
  { id: 'ethereum-usdc', asset: 'USDC', place: 'Ethereum' },
] as const;

export type DepositSource = (typeof DEPOSIT_SOURCES)[number];
export type DepositSourceId = DepositSource['id'];

export const DEPOSIT_SOURCE_IDS = DEPOSIT_SOURCES.map((source) => source.id) as [DepositSourceId, ...DepositSourceId[]];

export function depositSource(id: string): DepositSource | undefined {
  return DEPOSIT_SOURCES.find((source) => source.id === id);
}

/** "USDC on Base". */
export function depositSourceLabel(source: DepositSource): string {
  return `${source.asset} on ${source.place}`;
}
