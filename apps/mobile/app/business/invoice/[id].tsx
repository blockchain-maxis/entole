import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { buildCheckoutLink } from '@entole/core/checkout-link';
import { dueDateLabel, INVOICE_STATUS_LABEL, invoiceDisplayStatus, localDay } from '@entole/core/invoices';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Button } from '@/components/ui/Button';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { Header } from '@/components/ui/Header';
import { PaymentCode } from '@/components/ui/PaymentCode';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { CHECKOUT_BASE } from '@/lib/onchain';
import { plainMessage } from '@/lib/send';

const TONE = { sent: 'neutral', paid: 'settled', overdue: 'halt', draft: 'neutral', held: 'caution' } as const;

/**
 * One invoice, with the link a client pays through. The QR and the link are the
 * same thing: whoever opens it lands on an invoice-style checkout for exactly
 * this amount. "Mark as paid" is a manual mark and says so — payments to the
 * link arrive in the balance; nothing here watches for them yet.
 */
export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const { paymentCode } = useBackend();
  const { account } = useAccount();
  const invoice = store.invoice(String(id));

  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [marking, setMarking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The link that was saved with the invoice is the one that was shared, so it
  // stays as it was. Only an invoice saved without one gets it built here.
  const payee = account?.displayName.trim() ?? '';
  const link = useMemo(() => {
    if (!invoice) return null;
    if (invoice.link) return invoice.link;
    if (!paymentCode) return null;
    return buildCheckoutLink(CHECKOUT_BASE, {
      code: paymentCode,
      kind: 'invoice',
      amountMinor: invoice.amountMinor,
      currency: 'NGN',
      ...(payee ? { payee } : {}),
      ...(invoice.reference ? { reference: invoice.reference } : {}),
      note: invoice.note,
      dueAt: localDay(invoice.dueAt),
    });
  }, [invoice, paymentCode, payee]);

  async function copy() {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  async function markPaid() {
    if (!invoice || marking) return;
    setMarking(true);
    setProblem(null);
    try {
      await store.settleInvoice(invoice.id);
      setConfirming(false);
    } catch (error) {
      setProblem(plainMessage(error, "We couldn't update that invoice. Try again."));
    } finally {
      setMarking(false);
    }
  }

  if (store.status === 'loading') {
    return (
      <Screen>
        <Header title="Invoice" />
        <View className="px-gutter-lg pt-2">
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="mt-4 h-10 w-52 rounded-chip" />
          <Skeleton className="mt-6 h-[260px] w-full rounded-panel" />
        </View>
      </Screen>
    );
  }

  if (!invoice) {
    return (
      <Screen>
        <Header title="Invoice" />
        <View className="px-gutter-lg pt-4">
          <Text className="font-strong text-body text-ink">We couldn&apos;t find that invoice.</Text>
          <Text className="mt-1 font-body text-label text-slate">It may have been removed from this phone.</Text>
        </View>
      </Screen>
    );
  }

  const status = invoiceDisplayStatus(invoice);
  const paid = invoice.status === 'paid';

  return (
    <View className="flex-1">
      <Screen>
        <Header title={invoice.reference ?? 'Invoice'} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 4 }}
        >
          <View className="px-1">
            <StatusChip label={INVOICE_STATUS_LABEL[status]} tone={TONE[status]} />
            <Text numberOfLines={2} className="mt-3 font-strong text-title text-ink">
              {invoice.clientName}
            </Text>
            <Text tabular className="mt-1 font-strong text-amount-lg text-ink">
              {formatNaira(kobo(invoice.amountMinor))}
            </Text>
            <Text className="mt-2 font-body text-label text-slate">{invoice.note}</Text>
            <Text tabular className="mt-1 font-body text-label text-slate">
              {paid && invoice.paidAt
                ? `Marked as paid on ${dueDateLabel(invoice.paidAt)}`
                : `Due ${dueDateLabel(invoice.dueAt)}`}
            </Text>
          </View>

          <View className="mt-6 items-center rounded-panel bg-card px-gutter py-7 shadow-raised">
            {link ? (
              <>
                <PaymentCode value={link} />
                <Text
                  selectable
                  numberOfLines={2}
                  ellipsizeMode="middle"
                  className="mt-5 text-center font-body text-caption text-slate"
                >
                  {link}
                </Text>
              </>
            ) : (
              <View className="items-center">
                <Skeleton className="h-[232px] w-[232px] rounded-row" />
                <Skeleton className="mt-5 h-4 w-56 rounded-md" />
              </View>
            )}
          </View>

          <Text className="mt-5 px-1 font-body text-body-sm text-slate">
            Send this link to your client. It opens an invoice for exactly this amount, and what they pay
            arrives in your balance.
          </Text>

          {paid ? null : (
            <View className="mt-7 rounded-row border border-line bg-card px-4 py-4">
              <Text className="font-strong text-body-sm text-ink">Been paid already?</Text>
              <Text className="mt-1 font-body text-label-sm text-slate">
                Entole doesn&apos;t match payments to invoices yet, so this is a mark you make yourself. It
                only updates this list — no money moves. Once activity syncing is on, invoices will be
                marked paid automatically.
              </Text>
              <View className="mt-3 flex-row">
                <Button
                  label="Mark as paid"
                  variant="secondary"
                  width="hug"
                  onPress={() => {
                    setProblem(null);
                    setConfirming(true);
                  }}
                />
              </View>
            </View>
          )}
        </ScrollView>

        <ActionBar>
          <Button
            label={copied ? 'Copied' : 'Copy link'}
            variant="secondary"
            disabled={!link}
            onPress={() => void copy()}
          />
          <Button
            label="Share link"
            disabled={!link}
            onPress={() => {
              if (!link) return;
              const from = payee ? ` from ${payee}` : '';
              const ref = invoice.reference ? ` ${invoice.reference}` : '';
              void Share.share({
                message: `Invoice${ref}${from} for ${formatNaira(kobo(invoice.amountMinor))}, due ${dueDateLabel(invoice.dueAt)}: ${link}`,
              });
            }}
          />
        </ActionBar>
      </Screen>

      {confirming ? (
        <ConfirmSheet
          title={`Mark ${invoice.reference ?? 'this invoice'} as paid?`}
          body={`Only do this if ${invoice.clientName} has paid you. It changes this list and nothing else.`}
          confirmLabel="Mark as paid"
          busy={marking}
          problem={problem}
          onConfirm={() => void markPaid()}
          onDismiss={() => setConfirming(false)}
        />
      ) : null}
    </View>
  );
}
