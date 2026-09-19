import { useRouter } from 'expo-router';
import { Plus, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/lib/theme';
import { useStore } from '@entole/core/store';

type Row = { key: number; name: string; quantity: string };

/**
 * A request-drafting tool, not a marketplace. Saving records what you asked a
 * supplier for so it is written down — Entole does not source, order or ship
 * anything on your behalf, and the status says exactly that: "requested".
 */
export default function OrderSupplies() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();
  const nextKey = useRef(1);

  const [supplierName, setSupplierName] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([{ key: 0, name: '', quantity: '' }]);
  const [saving, setSaving] = useState(false);

  const items = rows
    .map((row) => ({ name: row.name.trim(), quantity: Number.parseInt(row.quantity, 10) }))
    .filter((item) => item.name.length > 0 && Number.isInteger(item.quantity) && item.quantity > 0);
  const ready = supplierName.trim().length > 0 && items.length > 0;

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, { key: nextKey.current++, name: '', quantity: '' }]);
  }

  function removeRow(key: number) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current));
  }

  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await store.createProcurementRequest({
        supplierName: supplierName.trim(),
        items,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      router.replace('/business');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Header title="Order supplies" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="font-body text-label-sm text-slate">
          Write down what you need from a supplier. This saves a request to your records — Entole does not place or
          ship the order.
        </Text>

        <Text className="mt-6 font-heavy text-body-sm text-ink">Supplier</Text>
        <TextInput
          value={supplierName}
          onChangeText={setSupplierName}
          placeholder="Who you are ordering from"
          placeholderTextColor={colors.mist}
          className="mt-2.5 rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink"
        />

        <Text className="mt-6 font-heavy text-body-sm text-ink">Items</Text>
        <View className="mt-2.5 gap-2.5">
          {rows.map((row) => (
            <View key={row.key} className="flex-row items-center gap-2.5">
              <TextInput
                value={row.name}
                onChangeText={(text) => updateRow(row.key, { name: text })}
                placeholder="Item"
                placeholderTextColor={colors.mist}
                className="flex-1 rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink"
              />
              <TextInput
                value={row.quantity}
                onChangeText={(text) => updateRow(row.key, { quantity: text.replace(/\D/g, '') })}
                placeholder="Qty"
                placeholderTextColor={colors.mist}
                keyboardType="number-pad"
                className="w-[76px] rounded-control border border-line bg-card px-3 py-3.5 text-center font-body text-body text-ink"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove item"
                hitSlop={10}
                disabled={rows.length === 1}
                onPress={() => removeRow(row.key)}
                className={rows.length === 1 ? 'opacity-30' : ''}
              >
                <X size={18} strokeWidth={1.5} color={colors.slate} />
              </Pressable>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={addRow}
          className="mt-3 flex-row items-center gap-1.5 self-start"
        >
          <Plus size={16} strokeWidth={1.5} color={colors.indigo.DEFAULT} />
          <Text className="font-strong text-label text-indigo">Add another item</Text>
        </Pressable>

        <Text className="mt-6 font-heavy text-body-sm text-ink">Note</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything the supplier should know (optional)"
          placeholderTextColor={colors.mist}
          className="mt-2.5 rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink"
        />
      </ScrollView>

      <ActionBar>
        <Button
          label={saving ? 'Saving' : 'Save request'}
          busy={saving}
          disabled={!ready}
          onPress={() => void save()}
        />
      </ActionBar>
    </Screen>
  );
}
