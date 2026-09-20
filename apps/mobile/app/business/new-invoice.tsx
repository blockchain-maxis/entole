import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { buildCheckoutLink } from '@entole/core/checkout-link';
import { dueInDays, localDay, nextInvoiceReference } from '@entole/core/invoices';
import { kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Amount } from '@/components/ui/Amount';
import { AmountSheet } from '@/components/ui/AmountSheet';
import { Button } from '@/components/ui/Button';
import { DueSheet, dueSummary, type DueChoice } from '@/components/ui/DueSheet';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { CHECKOUT_BASE } from '@/lib/onchain';
import { plainMessage } from '@/lib/send';
import { useThemeColors } from '@/lib/theme';

/**
 * A new invoice: who it is for, what for, how much and when it is due. Saving
 * it makes a real checkout link — the same kind Receive gives, in its invoice
 * form, carrying the amount, the invoice number, the note and the due date —
 * and lands on the invoice, where the link is ready to send.
 *
 * The amount goes in through the keypad sheet, never the system keyboard.
 */
export default function NewInvoice() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();
  const { paymentCode } = useBackend();
  const { account } = useAccount();

  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(0);
  const [dueAt, setDueAt] = useState(() => dueInDays(14));
  const [dueChoice, setDueChoice] = useState<DueChoice>({ kind: 'days', days: 14 });
  const [sheet, setSheet] = useState<'amount' | 'due' | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const loading = store.status === 'loading';
  const reference = useMemo(() => nextInvoiceReference(store.invoices), [store.invoices]);
  const ready = clientName.trim().length > 0 && note.trim().length > 0 && amount > 0 && !loading;

  async function save() {
    if (!ready || saving) return;
    setProblem(null);

    const payee = account?.displayName.trim() ?? '';
    const link = paymentCode
      ? buildCheckoutLink(CHECKOUT_BASE, {
          code: paymentCode,
          kind: 'invoice',
          amountMinor: amount,
          currency: 'NGN',
          ...(payee ? { payee } : {}),
          reference,
          note: note.trim(),
          dueAt: localDay(dueAt),
        })
      : null;
    if (!link) {
      setProblem("Your payment link isn't ready yet. Wait a moment and try again.");
      return;
    }

    setSaving(true);
    try {
      const invoice = await store.createInvoice({
        clientName: clientName.trim(),
        amountMinor: amount,
        note: note.trim(),
        dueAt,
        reference,
        link,
      });
      router.replace({ pathname: '/business/invoice/[id]', params: { id: invoice.id } });
    } catch (error) {
      setProblem(plainMessage(error, "We couldn't save that invoice. Try again."));
      setSaving(false);
    }
  }

  return (
    <View className="flex-1">
      <Screen>
        <Header title="New invoice" />

        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, paddingTop: 4 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change the amount"
              onPress={() => setSheet('amount')}
              className="rounded-row border border-line bg-card px-4 py-4 active:border-mist"
            >
              <Text className="font-strong text-caption text-slate">Amount</Text>
              <View className="mt-2 flex-row items-center justify-between">
                {amount > 0 ? (
                  <Amount value={kobo(amount)} size="medium" />
                ) : (
                  <Text className="font-strong text-amount-sm text-mist">Tap to enter</Text>
                )}
                <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
              </View>
            </Pressable>

            <View className="mt-5">
              <Field
                label="Who is it for?"
                value={clientName}
                onChangeText={setClientName}
                placeholder="Client or business name"
                autoCapitalize="words"
                returnKeyType="next"
                maxLength={60}
              />
            </View>

            <View className="mt-5">
              <Field
                label="What is it for?"
                value={note}
                onChangeText={setNote}
                placeholder="September deliveries"
                autoCapitalize="sentences"
                maxLength={140}
              />
            </View>

            <Text className="mt-5 font-strong text-caption text-slate">Due</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change the due date"
              onPress={() => setSheet('due')}
              className="mt-2 flex-row items-center justify-between rounded-control border-[1.5px] border-line bg-card px-4 py-3.5 active:border-mist"
            >
              <Text tabular className="font-strong text-body-lg text-ink">
                {dueSummary(dueChoice, dueAt)}
              </Text>
              <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
            </Pressable>

            <Text className="mt-6 font-body text-label-sm text-slate">
              This is invoice {reference}. Saving it makes a link you can send. Anything paid to that link
              arrives in your balance.
            </Text>

            {problem ? <Text className="mt-3 font-body text-label-sm text-halt">{problem}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <ActionBar>
          <Button label="Create invoice" busy={saving} disabled={!ready} onPress={() => void save()} />
        </ActionBar>
      </Screen>

      {sheet === 'amount' ? (
        <AmountSheet
          title="Invoice amount"
          hint="What your client owes you."
          current={amount}
          onSet={(next) => {
            setAmount(next);
            setSheet(null);
          }}
          onDismiss={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'due' ? (
        <DueSheet
          onPick={(iso, choice) => {
            setDueAt(iso);
            setDueChoice(choice);
            setSheet(null);
          }}
          onDismiss={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}
