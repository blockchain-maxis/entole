import { useRouter } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/lib/theme';
import { entryDisplay, entryToMinor, pressKey, type AmountEntry, EMPTY_ENTRY } from '@entole/core/amount-entry';
import { useStore } from '@entole/core/store';

const DUE_IN_DAYS = 14;

/** One-click generation, reusing the same settlement-link surface a
 * personal payment request already has. */
export default function NewInvoice() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();

  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState('');
  const [entry, setEntry] = useState<AmountEntry>(EMPTY_ENTRY);
  const [saving, setSaving] = useState(false);

  const amount = entryToMinor(entry);
  const ready = clientName.trim().length > 0 && note.trim().length > 0 && amount > 0;

  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const dueAt = new Date(Date.now() + DUE_IN_DAYS * 86_400_000).toISOString();
      const invoice = await store.createInvoice({
        clientName: clientName.trim(),
        amountMinor: amount,
        note: note.trim(),
        dueAt,
      });
      router.replace({ pathname: '/business', params: { newInvoiceId: invoice.id } });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Header title="New invoice" />

      <View className="flex-1 px-gutter-lg pt-[18px]">
        <Text className="font-heavy text-body-sm text-ink">Bill to</Text>
        <TextInput
          value={clientName}
          onChangeText={setClientName}
          placeholder="Client or business name"
          placeholderTextColor={colors.mist}
          className="mt-2.5 rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink"
        />

        <Text className="mt-5 font-heavy text-body-sm text-ink">For</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What this invoice is for"
          placeholderTextColor={colors.mist}
          className="mt-2.5 rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink"
        />

        <Text className="mt-6 font-heavy text-body-sm text-ink">Amount</Text>
        <Text tabular className="mt-2.5 font-strong text-amount text-ink">
          ₦{entryDisplay(entry)}
        </Text>
        <Text className="mt-1.5 font-body text-label-sm text-slate">Due in {DUE_IN_DAYS} days</Text>
      </View>

      <View className="flex-none px-3.5 pb-1">
        <Keypad onKey={(key) => setEntry((current) => pressKey(current, key))} />
      </View>
      <ActionBar>
        <Button label={saving ? 'Sending' : 'Send invoice'} busy={saving} disabled={!ready} onPress={() => void save()} />
      </ActionBar>
    </Screen>
  );
}
