'use client';

import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { useStore } from '@entole/core/store';

import { Header } from '@/components/Header';

type Row = { key: number; name: string; quantity: string };

const FIELD =
  'w-full rounded-control border border-line bg-card px-4 py-3.5 font-body text-body text-ink placeholder:text-mist';

/**
 * A request-drafting tool, not a marketplace. Saving records what you asked a
 * supplier for so it is written down — Entole does not source, order or ship
 * anything on your behalf, and the status says exactly that: "requested".
 */
export default function OrderSuppliesPage() {
  const router = useRouter();
  const store = useStore();
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
      router.push('/business');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">
      <Header title="Order supplies" back="/business" />

      <div className="flex-1 px-gutter-lg pb-28">
        <p className="font-body text-label-sm text-slate">
          Write down what you need from a supplier. This saves a request to your records — Entole does not place or
          ship the order.
        </p>

        <p className="mt-6 font-heavy text-body-sm text-ink">Supplier</p>
        <input
          value={supplierName}
          onChange={(event) => setSupplierName(event.target.value)}
          placeholder="Who you are ordering from"
          className={`mt-2.5 ${FIELD}`}
        />

        <p className="mt-6 font-heavy text-body-sm text-ink">Items</p>
        <div className="mt-2.5 flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2.5">
              <input
                value={row.name}
                onChange={(event) => updateRow(row.key, { name: event.target.value })}
                placeholder="Item"
                aria-label="Item name"
                className={`flex-1 ${FIELD}`}
              />
              <input
                value={row.quantity}
                onChange={(event) => updateRow(row.key, { quantity: event.target.value.replace(/\D/g, '') })}
                placeholder="Qty"
                aria-label="Quantity"
                inputMode="numeric"
                className="w-[76px] rounded-control border border-line bg-card px-3 py-3.5 text-center font-body text-body text-ink placeholder:text-mist"
              />
              <button
                type="button"
                aria-label="Remove item"
                disabled={rows.length === 1}
                onClick={() => removeRow(row.key)}
                className="text-slate disabled:opacity-30"
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="mt-3 flex items-center gap-1.5 font-strong text-label text-indigo hover:underline"
        >
          <Plus size={16} strokeWidth={1.5} />
          Add another item
        </button>

        <p className="mt-6 font-heavy text-body-sm text-ink">Note</p>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything the supplier should know (optional)"
          className={`mt-2.5 ${FIELD}`}
        />

        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void save()}
          className="mt-6 flex h-14 w-full items-center justify-center rounded-control bg-ink font-strong text-body-lg text-paper transition-colors hover:bg-indigo-deep disabled:opacity-60"
        >
          {saving ? 'Saving' : 'Save request'}
        </button>
      </div>
    </main>
  );
}
