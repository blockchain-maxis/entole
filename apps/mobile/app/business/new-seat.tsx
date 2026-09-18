import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { Keypad } from '@/components/ui/Keypad';
import { Screen } from '@/components/ui/Screen';
import { Sentence, type SentencePart } from '@/components/ui/Sentence';
import { SheetGrabber } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { cadenceDetail, cadenceWords } from '@entole/core/allowance';
import { entryDisplay, entryFromMinor, entryToMinor, pressKey, type AmountEntry } from '@entole/core/amount-entry';
import { formatNaira, kobo, naira, type Naira } from '@entole/core/money';
import type { Cadence, Contact, SeatRole } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

type Slot = 'role' | 'person' | 'cadence' | 'amount' | 'limit';

const CADENCES: Cadence[] = ['weekly', 'monthly', 'on-request'];
const ROLES: { value: SeatRole; label: string; spends: boolean }[] = [
  { value: 'officer', label: 'Officer', spends: true },
  { value: 'admin', label: 'Admin', spends: false },
  { value: 'bookkeeper', label: 'Bookkeeper', spends: false },
];

/**
 * A seat is a sentence too — the same fill-in-the-blank pattern as a
 * personal allowance, because underneath it is one: spending power granted
 * to a person instead of to the assistant.
 */
export default function NewSeat() {
  const router = useRouter();
  const store = useStore();

  const [slot, setSlot] = useState<Slot>('role');
  const [role, setRole] = useState<SeatRole>('officer');
  const [contactId, setContactId] = useState(store.contacts[0]?.id ?? '');
  const [perRun, setPerRun] = useState<Naira>(naira(50_000));
  const [limit, setLimit] = useState<Naira>(naira(200_000));
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [saving, setSaving] = useState(false);

  const person = store.contact(contactId);
  const spends = ROLES.find((r) => r.value === role)?.spends ?? false;
  const period = cadence === 'weekly' ? 'a week' : 'a month';

  const parts: SentencePart[] = [
    { kind: 'words', text: 'Grant ' },
    { kind: 'pill', id: 'role', text: role },
    { kind: 'words', text: ' to ' },
    {
      kind: 'pill',
      id: 'person',
      text: person?.name ?? 'someone',
      ...(person ? { avatar: { initials: person.initials, tone: person.tone } } : {}),
    },
    ...(spends
      ? ([
          { kind: 'words', text: ', up to ' } as const,
          { kind: 'pill', id: 'amount', text: formatNaira(perRun), tabular: true } as const,
          { kind: 'words', text: ' ' } as const,
          { kind: 'pill', id: 'cadence', text: cadenceWords(cadence) } as const,
          { kind: 'words', text: ', never more than ' } as const,
          { kind: 'pill', id: 'limit', text: formatNaira(limit), tabular: true } as const,
          { kind: 'words', text: ` ${period}.` } as const,
        ] satisfies SentencePart[])
      : [{ kind: 'words', text: '.' } as const]),
  ];

  async function save() {
    if (!person || saving) return;
    setSaving(true);
    try {
      await store.saveSeat({
        name: `${ROLES.find((r) => r.value === role)?.label} — ${person.name.split(' ')[0]}`,
        contactId,
        role,
        perRunMinor: spends ? perRun : 0,
        limitMinor: spends ? limit : 0,
        cadence: spends ? cadence : 'on-request',
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Header title="New seat" />

      <View className="flex-1 px-gutter-lg pt-[18px]">
        <Sentence parts={parts} activeId={slot} onPressPill={(next) => setSlot(next as Slot)} />
        <Text className="mt-[26px] font-body text-label text-mist">
          Tap any highlighted value to change it.
        </Text>
      </View>

      <View className="flex-none rounded-t-panel border-t border-line bg-card px-gutter pb-3.5 pt-5">
        <SheetGrabber />

        {slot === 'role' ? (
          <RolePicker value={role} onChange={setRole} />
        ) : slot === 'person' ? (
          <PersonPicker contacts={store.contacts} value={contactId} onChange={setContactId} />
        ) : slot === 'cadence' ? (
          <CadencePicker value={cadence} onChange={setCadence} />
        ) : (
          <AmountPad
            title={slot === 'amount' ? 'How much each time' : `Never more than, ${period}`}
            value={slot === 'amount' ? perRun : limit}
            onChange={slot === 'amount' ? setPerRun : setLimit}
          />
        )}

        <View className="mt-4 flex-row">
          <Button
            label="Grant seat"
            busy={saving}
            disabled={!person || (spends && limit < perRun)}
            onPress={() => void save()}
          />
        </View>

        {spends && limit < perRun ? (
          <Text className="mt-3 text-center font-body text-label-sm text-caution">
            The cap has to be at least as large as one payment.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function RolePicker({ value, onChange }: { value: SeatRole; onChange: (next: SeatRole) => void }) {
  return (
    <View>
      <Text className="px-1 font-heavy text-body-sm text-ink">What they can do</Text>
      <View className="mt-3.5 gap-2">
        {ROLES.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              className={`flex-row items-center justify-between rounded-chip px-4 ${
                selected
                  ? 'border-[1.5px] border-indigo bg-indigo-wash py-[13.5px]'
                  : 'border border-hairline bg-paper py-3.5'
              }`}
            >
              <Text className={`text-body ${selected ? 'font-strong text-ink' : 'font-body text-slate'}`}>
                {option.label}
              </Text>
              <Text className={`text-caption ${selected ? 'font-heavy text-indigo' : 'font-strong text-mist'}`}>
                {option.spends ? 'Capped allowance' : 'No spend'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PersonPicker({
  contacts,
  value,
  onChange,
}: {
  contacts: Contact[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View>
      <Text className="px-1 font-heavy text-body-sm text-ink">Who it goes to</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14, paddingHorizontal: 4, paddingVertical: 14 }}
      >
        {contacts.map((contact) => {
          const selected = contact.id === value;
          return (
            <Pressable
              key={contact.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={contact.name}
              onPress={() => onChange(contact.id)}
              className="w-16 items-center gap-1.5"
            >
              <View className={selected ? 'rounded-pill border-2 border-indigo p-0.5' : 'p-0.5'}>
                <Avatar initials={contact.initials} tone={contact.tone} size="lg" />
              </View>
              <Text
                numberOfLines={1}
                className={`text-caption-sm ${selected ? 'font-strong text-ink' : 'font-body text-slate'}`}
              >
                {contact.name.split(' ')[0]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CadencePicker({ value, onChange }: { value: Cadence; onChange: (next: Cadence) => void }) {
  return (
    <View>
      <Text className="px-1 font-heavy text-body-sm text-ink">How often</Text>
      <View className="mt-3.5 gap-2">
        {CADENCES.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option)}
              className={`flex-row items-center justify-between rounded-chip px-4 ${
                selected
                  ? 'border-[1.5px] border-indigo bg-indigo-wash py-[13.5px]'
                  : 'border border-hairline bg-paper py-3.5'
              }`}
            >
              <Text className={`text-body ${selected ? 'font-strong text-ink' : 'font-body text-slate'}`}>
                {cadenceWords(option).charAt(0).toUpperCase() + cadenceWords(option).slice(1)}
              </Text>
              <Text className={`text-caption ${selected ? 'font-heavy text-indigo' : 'font-strong text-mist'}`}>
                {selected ? `${cadenceDetail(option)} · selected` : cadenceDetail(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AmountPad({ title, value, onChange }: { title: string; value: Naira; onChange: (next: Naira) => void }) {
  const [entry, setEntry] = useState<AmountEntry>(() => entryFromMinor(value));

  return (
    <View>
      <View className="flex-row items-baseline justify-between px-1">
        <Text className="font-heavy text-body-sm text-ink">{title}</Text>
        <Text tabular className="font-strong text-amount-sm text-ink">
          ₦{entryDisplay(entry)}
        </Text>
      </View>
      <View className="mt-3">
        <Keypad
          onKey={(key) => {
            setEntry((current) => {
              const next = pressKey(current, key);
              onChange(kobo(entryToMinor(next)));
              return next;
            });
          }}
        />
      </View>
    </View>
  );
}
