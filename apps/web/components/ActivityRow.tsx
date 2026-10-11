import { relativeMoment } from '@entole/core/format';
import { formatDelta, kobo } from '@entole/core/money';
import type { Activity, Contact } from '@entole/core/schemas';

import { Avatar } from './Avatar';
import { AssistantBadge } from './Badge';

function byAssistant(entry: Activity): boolean {
  return entry.initiatedBy === 'assistant';
}

/**
 * One line of the feed, on paper. Your own payments are plain; one the
 * assistant made carries the assistant's tint and its badge, so the two can
 * never be mistaken for each other. `ruled` draws the hairline above a row.
 */
export function ActivityRow({
  entry,
  contact,
  ruled = false,
}: {
  entry: Activity;
  contact: Contact | undefined;
  ruled?: boolean;
}) {
  const assistant = byAssistant(entry);
  const amount = formatDelta(kobo(entry.amountMinor), entry.direction);
  const pending = entry.state === 'pending';

  return (
    <li
      className={`flex items-center gap-3 py-3 ${
        assistant ? '-mx-3 rounded-control bg-indigo-wash px-3' : ruled ? 'border-t border-hairline' : ''
      }`}
    >
      <Avatar initials={contact?.initials ?? '?'} tone={contact?.tone ?? 1} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-strong text-ui text-ink">{contact?.name ?? 'Someone'}</span>
          {assistant ? <AssistantBadge /> : null}
        </div>
        <p className="tabular mt-0.5 truncate font-body text-note text-slate">
          {entry.note} · {pending ? 'Sending' : relativeMoment(entry.at)}
        </p>
      </div>

      <span
        className={`tabular flex-none font-strong text-ui ${
          pending ? 'text-slate' : entry.direction === 'in' ? 'text-settled' : 'text-ink'
        }`}
      >
        {amount}
      </span>
    </li>
  );
}

/**
 * The feed as a list: a hairline between two of your own payments, and none
 * against a tinted row, which is already set apart.
 */
export function ActivityList({
  entries,
  contactFor,
}: {
  entries: Activity[];
  contactFor: (id: string) => Contact | undefined;
}) {
  return (
    <ul>
      {entries.map((entry, index) => {
        const previous = entries[index - 1];
        const ruled = Boolean(previous) && !byAssistant(entry) && !byAssistant(previous!);
        return <ActivityRow key={entry.id} entry={entry} contact={contactFor(entry.contactId)} ruled={ruled} />;
      })}
    </ul>
  );
}
