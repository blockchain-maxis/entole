import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { AllowanceCard } from '@/components/ui/AllowanceCard';
import { AssistantTag } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { PauseButton } from '@/components/ui/PauseButton';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { Screen } from '@/components/ui/Screen';
import { AllowanceCardSkeleton, RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatRate } from '@entole/core/fx';
import { formatNaira, kobo } from '@entole/core/money';
import { resetLabel } from '@entole/core/format';
import { useStore } from '@entole/core/store';
import { useState } from 'react';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', officer: 'Officer', bookkeeper: 'Bookkeeper' };

/**
 * Seats, invoices and the tax reserve — the business layer added 17
 * September 2026 (docs/SCOPE.md). Everything on this screen either is an
 * allowance already, or settles into one.
 */
export default function Business() {
  const router = useRouter();
  const store = useStore();
  const loading = store.status === 'loading';
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function checkRelease(invoiceId: string) {
    setCheckingId(invoiceId);
    try {
      await store.requestConditionalRelease(invoiceId, store.rate);
    } finally {
      setCheckingId(null);
    }
  }

  const spendingSeats = store.seats.filter((seat) => seat.limitMinor > 0);
  const otherSeats = store.seats.filter((seat) => seat.limitMinor === 0);
  const outstandingInvoices = store.invoices.filter((invoice) => invoice.status !== 'paid');

  if (loading) {
    return (
      <Screen edges={{ bottom: false }}>
        <Header title="Business" trailing={<PauseButton />} />
        <View className="gap-2.5 px-5 pt-2">
          <RowSkeleton />
          <AllowanceCardSkeleton />
          <AllowanceCardSkeleton />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={{ bottom: false }}>
      <Header title="Business" trailing={<PauseButton />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {store.taxReserves.length > 0 ? (
          <View className="mb-7 rounded-panel bg-card p-5 shadow-raised">
            <AssistantTag>Tax reserve</AssistantTag>
            <View className="mt-3 flex-row items-baseline gap-1.5">
              <Text tabular className="font-strong text-amount text-ink">
                {formatNaira(kobo(store.taxReserves[0]!.balanceMinor))}
              </Text>
            </View>
            <Text className="mt-1.5 font-body text-label-sm text-slate">
              Held aside, {resetLabel(store.taxReserves[0]!.payoutAt)}
            </Text>
          </View>
        ) : null}

        <SectionHeading
          title="Invoices"
          action="New"
          onActionPress={() => router.push('/business/new-invoice')}
        />
        <View className="gap-2.5">
          {store.invoices.length === 0 ? (
            <Text className="px-1 font-body text-label-sm text-mist">No invoices yet.</Text>
          ) : (
            store.invoices.map((invoice) => (
              <View
                key={invoice.id}
                className="rounded-row border border-line bg-card px-4 py-3.5"
              >
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="flex-1 font-strong text-body text-ink">{invoice.clientName}</Text>
                  <Text
                    className={`font-heavy text-caption-sm uppercase ${
                      invoice.status === 'paid' ? 'text-settled' : 'text-slate'
                    }`}
                  >
                    {invoice.status === 'pending-release' ? 'Held' : invoice.status}
                  </Text>
                </View>
                <Text tabular className="mt-1.5 font-strong text-amount-sm text-ink">
                  {formatNaira(kobo(invoice.amountMinor))}
                </Text>
                <Text className="mt-0.5 font-body text-caption-sm text-slate">{invoice.note}</Text>
                {invoice.releaseCondition ? (
                  <Text className="mt-1.5 font-body text-caption-sm text-slate">
                    Releases at {formatRate({ koboPerDollar: invoice.releaseCondition.maxKoboPerDollar, quotedAt: '' })} or
                    better · now {formatRate(store.rate)}
                  </Text>
                ) : null}
                {invoice.status === 'pending-release' ? (
                  <View className="mt-3">
                    <Button
                      label="Check condition"
                      variant="secondary"
                      width="hug"
                      busy={checkingId === invoice.id}
                      onPress={() => void checkRelease(invoice.id)}
                    />
                  </View>
                ) : invoice.status !== 'paid' ? (
                  <View className="mt-3">
                    <Button
                      label="Mark as paid"
                      variant="secondary"
                      width="hug"
                      onPress={() => void store.settleInvoice(invoice.id)}
                    />
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>

        {outstandingInvoices.length === 0 && store.invoices.length > 0 ? (
          <Text className="mt-2 px-1 font-body text-label-sm text-settled">All caught up.</Text>
        ) : null}

        <SectionHeading title="Seats" action="Add" className="pt-7" onActionPress={() => router.push('/business/new-seat')} />
        <View className="gap-2.5">
          {spendingSeats.map((seat) => (
            <AllowanceCard key={seat.id} allowance={seat} resetsAt={seat.resetsAt} />
          ))}
          {otherSeats.map((seat) => {
            const contact = store.contact(seat.recipientId);
            return (
              <ContactRow
                key={seat.id}
                contact={
                  contact ?? { id: seat.recipientId, name: seat.name, initials: '?', tone: 1 }
                }
                trailing={<Text className="font-heavy text-caption-sm uppercase text-slate">{ROLE_LABEL[seat.role]}</Text>}
              />
            );
          })}
          {store.seats.length === 0 ? (
            <Text className="px-1 font-body text-label-sm text-mist">No seats granted yet.</Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
