import { useRouter, type Href } from 'expo-router';
import { ChevronRight, FileText, Truck, UserPlus, Users, type LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { dueDateLabel, INVOICE_STATUS_LABEL, invoiceDisplayStatus } from '@entole/core/invoices';
import { formatNaira, kobo } from '@entole/core/money';
import type { Invoice } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { Text } from '@/components/ui/Text';
import { cadenceWord, useStaff } from '@/lib/staff';
import { useThemeColors } from '@/lib/theme';
import { initialsFor } from '@entole/core/profile';

const TONE = { sent: 'neutral', paid: 'settled', overdue: 'halt', draft: 'neutral', held: 'caution' } as const;

type Hub = { label: string; hint: string; Icon: LucideIcon; href: Href };

/** One row per job the business does. Each says in a line what it is for and
 * goes straight to the place that does it. */
function HubRow({ hub, note, onPress }: { hub: Hub; note?: string | null; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hub.label}
      onPress={onPress}
      className="flex-row items-center gap-3.5 rounded-row border border-line bg-card px-4 py-3.5 active:border-mist"
    >
      <View className="h-11 w-11 items-center justify-center rounded-chip bg-track">
        <hub.Icon size={21} strokeWidth={1.5} color={colors.ink} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-strong text-body text-ink">{hub.label}</Text>
        <Text numberOfLines={1} className="mt-0.5 font-body text-caption text-slate">
          {hub.hint}
        </Text>
      </View>
      {note ? (
        <Text tabular className="font-strong text-caption text-slate">
          {note}
        </Text>
      ) : null}
      <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
    </Pressable>
  );
}

function InvoiceRow({ invoice, onPress }: { invoice: Invoice; onPress: () => void }) {
  const status = invoiceDisplayStatus(invoice);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Invoice for ${invoice.clientName}`}
      onPress={onPress}
      className="rounded-row border border-line bg-card px-4 py-3.5 active:border-mist"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-strong text-body text-ink">
            {invoice.clientName}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 font-body text-caption text-slate">
            {invoice.reference ? `${invoice.reference} · ` : ''}
            {status === 'paid' ? 'Paid' : `Due ${dueDateLabel(invoice.dueAt)}`}
          </Text>
        </View>
        <View className="items-end gap-1.5">
          <Text tabular className="font-strong text-body text-ink">
            {formatNaira(kobo(invoice.amountMinor))}
          </Text>
          <StatusChip label={INVOICE_STATUS_LABEL[status]} tone={TONE[status]} />
        </View>
      </View>
    </Pressable>
  );
}

/** A nothing-yet state that says what to do about it. */
function EmptyCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <View className="rounded-row border border-line bg-card px-4 py-4">
      <Text className="font-strong text-body-sm text-ink">{title}</Text>
      <Text className="mt-1 font-body text-label-sm text-slate">{body}</Text>
      {children ? <View className="mt-3 flex-row gap-2.5">{children}</View> : null}
    </View>
  );
}

/**
 * The business hub, in plain words: bill a client, pay your staff, pay a
 * supplier, keep your team. Invoices and the team's people are listed under
 * the four jobs. Everything here is a record on this phone or a payment through
 * the ordinary send — nothing is invented to fill the page.
 */
export default function Business() {
  const router = useRouter();
  const store = useStore();
  const team = useStaff();

  const loading = store.status === 'loading';
  const owed = store.invoices.filter((invoice) => invoice.status !== 'paid');
  const owedMinor = owed.reduce((sum, invoice) => sum + invoice.amountMinor, 0);
  const overdue = owed.filter((invoice) => invoiceDisplayStatus(invoice) === 'overdue').length;

  const invoicesHint =
    owed.length === 0
      ? 'Bill a client with a link'
      : `${formatNaira(kobo(owedMinor))} waiting${overdue > 0 ? ` · ${overdue} overdue` : ''}`;

  const hubs = {
    invoices: { label: 'Invoices', hint: invoicesHint, Icon: FileText, href: '/business/new-invoice' },
    staff: {
      label: 'Pay staff',
      hint: team.staff.length > 0 ? 'Pay your team in one go' : 'From a spreadsheet, or by hand',
      Icon: Users,
      href: '/business/payroll',
    },
    supplier: {
      label: 'Pay a supplier',
      hint: 'Send money to anyone with their code',
      Icon: Truck,
      href: '/send/pick?note=Supplier%20payment',
    },
    team: { label: 'Team', hint: 'Add someone you pay regularly', Icon: UserPlus, href: '/business/payroll/add' },
  } satisfies Record<string, Hub>;

  if (loading) {
    return (
      <Screen edges={{ bottom: false }}>
        <Header title="Business" leading="none" trailing={<PauseButton />} />
        <View className="gap-2.5 px-5 pt-2">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Business" leading="none" trailing={<PauseButton />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <View className="gap-2.5">
          <HubRow hub={hubs.invoices} onPress={() => router.push(hubs.invoices.href)} />
          <HubRow
            hub={hubs.staff}
            note={team.status === 'ready' && team.staff.length > 0 ? String(team.staff.length) : null}
            onPress={() => router.push(hubs.staff.href)}
          />
          <HubRow hub={hubs.supplier} onPress={() => router.push(hubs.supplier.href)} />
          <HubRow hub={hubs.team} onPress={() => router.push(hubs.team.href)} />
        </View>

        <SectionHeading
          title="Invoices"
          action={store.invoices.length > 0 ? 'New' : undefined}
          onActionPress={() => router.push('/business/new-invoice')}
          className="pt-8"
        />
        <View className="gap-2.5">
          {store.invoices.length === 0 ? (
            <EmptyCard
              title="No invoices yet"
              body="Make an invoice and you get a link to send. Your client pays it, and the money arrives in your balance."
            >
              <Button
                label="Create an invoice"
                variant="secondary"
                width="hug"
                onPress={() => router.push('/business/new-invoice')}
              />
            </EmptyCard>
          ) : (
            store.invoices.map((invoice) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                onPress={() => router.push({ pathname: '/business/invoice/[id]', params: { id: invoice.id } })}
              />
            ))
          )}
        </View>

        <SectionHeading
          title="Your team"
          action={team.staff.length > 0 ? 'Add' : undefined}
          onActionPress={() => router.push('/business/payroll/add')}
          className="pt-8"
        />
        <View className="gap-2.5">
          {team.status === 'loading' ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : team.status === 'failed' ? (
            <EmptyCard title="We couldn't load your team" body="They are saved on this phone. Try again.">
              <Button label="Try again" variant="secondary" width="hug" onPress={() => void team.reload()} />
            </EmptyCard>
          ) : team.staff.length === 0 ? (
            <EmptyCard
              title="No one on your team yet"
              body="Add the people you pay with their payment code, or bring them in from a spreadsheet."
            >
              <Button
                label="Add a person"
                variant="secondary"
                width="hug"
                onPress={() => router.push('/business/payroll/add')}
              />
              <Button
                label="Import"
                variant="secondary"
                width="hug"
                onPress={() => router.push('/business/payroll/import')}
              />
            </EmptyCard>
          ) : (
            team.staff.map((person) => (
              <Pressable
                key={person.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${person.name}`}
                onPress={() => router.push({ pathname: '/business/payroll/add', params: { id: person.id } })}
                className="flex-row items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3 active:border-mist"
              >
                <Avatar initials={initialsFor(person.name)} tone={1} size="lg" />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="font-strong text-body text-ink">
                    {person.name}
                  </Text>
                  <Text tabular numberOfLines={1} className="mt-0.5 font-body text-caption text-slate">
                    {person.payAmountMinor
                      ? `${formatNaira(kobo(person.payAmountMinor))}${cadenceWord(person.cadence) ? ` · ${cadenceWord(person.cadence)}` : ''}`
                      : 'No regular pay set'}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
