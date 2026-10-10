import type { StockDetail, StockListItem } from './stock-market';

/**
 * How a stock is shown, worked out once for both apps: the line of a month of
 * closes, how far it moved over that month, plain dates, and one sentence on
 * whether it can be traded right now. Nothing here knows a price of its own;
 * every figure comes in from `stock-market.ts`.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type ChangeTone = 'up' | 'down' | 'flat';

export function changeTone(bps: number): ChangeTone {
  return bps > 0 ? 'up' : bps < 0 ? 'down' : 'flat';
}

/**
 * The closes as the points of one line inside a `width` by `height` box,
 * oldest on the left, the highest close at the top. `null` when there are not
 * two closes to join.
 */
export function historyLine(
  history: StockDetail['history'],
  width: number,
  height: number,
  inset = 2,
): string | null {
  if (history.length < 2) return null;
  const closes = history.map((day) => day.closeCents);
  const low = Math.min(...closes);
  const span = Math.max(...closes) - low;
  const step = (width - inset * 2) / (closes.length - 1);
  const place = (value: number) => Math.round(value * 100) / 100;
  return closes
    .map((close, index) => {
      const x = inset + index * step;
      const y = span === 0 ? height / 2 : inset + (1 - (close - low) / span) * (height - inset * 2);
      return `${place(x)},${place(y)}`;
    })
    .join(' ');
}

/** From the first close shown to the last: since when, and by how much. */
export function historyChange(history: StockDetail['history']): { since: string; changeBps: number } | null {
  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last || history.length < 2) return null;
  return {
    since: first.date,
    changeBps: Math.round(((last.closeCents - first.closeCents) / first.closeCents) * 10_000),
  };
}

/** 2 to "0.02%", 150 to "1.50%". No sign: a share of the price, not a move. */
export function formatPercent(bps: number): string {
  return `${(Math.abs(bps) / 100).toFixed(2)}%`;
}

/** "2026-10-09" to "9 Oct". Anything else is the exchange's own wording, left as it is. */
export function formatStockDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month}` : value;
}

/** "Mon 12 Oct, 1:00 am", on the clock of whoever is reading. */
export function formatStockMoment(date: Date): string {
  const hours = date.getHours();
  const clock = `${hours % 12 === 0 ? 12 : hours % 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}, ${clock}`;
}

/** Whether it can be traded right now, and when that changes, in one or two short sentences. */
export function tradingStatus(detail: Pick<StockDetail, 'marketOpen' | 'marketChangesAt'>): string {
  const changes = detail.marketChangesAt ? new Date(detail.marketChangesAt) : null;
  const when = changes && !Number.isNaN(changes.getTime()) ? formatStockMoment(changes) : null;
  if (detail.marketOpen) return when ? `Trading is open. Closes ${when}.` : 'Trading is open.';
  return when ? `Trading is closed. Opens ${when}.` : 'Trading is closed.';
}

/**
 * The next page added to the list. The list can be refreshed between two
 * pages, so a stock already shown is not shown twice.
 */
export function appendStockPage(shown: StockListItem[], next: StockListItem[]): StockListItem[] {
  const seen = new Set(shown.map((item) => item.symbol));
  return [...shown, ...next.filter((item) => !seen.has(item.symbol))];
}

/** The small line under a name: its symbol and what it is. "NVDA · Technology", "SPY · Fund". */
export function stockByline(item: Pick<StockListItem, 'symbol' | 'kind' | 'sector'>): string {
  const what = item.kind === 'fund' ? 'Fund' : item.sector;
  return what ? `${item.symbol} · ${what}` : item.symbol;
}

/** "1,048 stocks", "1 fund". */
export function stockCountLabel(total: number, kind?: 'company' | 'fund'): string {
  const count = String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const one = kind === 'company' ? 'company' : kind === 'fund' ? 'fund' : 'stock';
  const many = kind === 'company' ? 'companies' : kind === 'fund' ? 'funds' : 'stocks';
  return `${count} ${total === 1 ? one : many}`;
}
