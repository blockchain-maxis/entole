import { relativeMoment } from '@entole/core/format';
import { formatDelta, kobo } from '@entole/core/money';
import type { Activity, Contact } from '@entole/core/schemas';

import { Avatar } from './Avatar';
import { AssistantBadge } from './Badge';

/**
 * One line of the feed. An assistant-initiated payment carries the assistant
 * tint and the badge; your own payments sit on plain card.
 */
export function ActivityRow({ entry, contact }: { entry: Activity; contact: Contact | undefined }) {
  const byAssistant = entry.initiatedBy === 'assistant';
  const amount = formatDelta(kobo(entry.amountMinor), entry.direction);
  const pending = entry.state === 'pending';

  return (
    <li
      className={`flex items-center gap-3 rounded-row border px-3.5 py-3 ${
        byAssistant ? 'border-indigo-line bg-indigo-wash' : 'border-line bg-card'
      }`}
    >
      <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-strong text-body text-ink">{contact?.name ?? 'Someone'}</span>
          {byAssistant ? <AssistantBadge /> : null}
        </div>
        <p className="tabular mt-0.5 font-body text-caption text-slate">
          {entry.note} · {pending ? 'Sending' : relativeMoment(entry.at)}
        </p>
      </div>

      <span
        className={`tabular font-strong text-body ${
          pending ? 'text-mist' : entry.direction === 'in' ? 'text-settled' : 'text-ink'
        }`}
      >
        {amount}
      </span>
    </li>
  );
}
