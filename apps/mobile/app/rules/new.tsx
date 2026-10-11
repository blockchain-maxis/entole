import { useLocalSearchParams, useRouter } from 'expo-router';
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
import type { Cadence, Contact } from '@entole/core/schemas';
import { useStore } from '@entole/core/store';

type Slot = 'amount' | 'recipient' | 'cadence' | 'limit';

const CADENCES: Cadence[] = ['weekly', 'monthly', 'on-request'];

/**
 * An allowance is a sentence you fill in, not a form and not a wizard. Whatever
 * you tap opens below; the sentence above always reads back in one breath.
 *
 * It is for one saved person. Until the person chooses, it is for the first
 * one saved; with nobody saved there is nothing to create, and the screen says
 * how to get there.
 */
export default function RuleBuilder() {
  const router = useRouter();
  const store = useStore();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = id ? store.allowance(id) : undefined;

  const [slot, setSlot] = useState<Slot>('cadence');
  const [perRun, setPerRun] = useState<Naira>(existing?.perRunMinor ?? naira(50_000));
  const [limit, setLimit] = useState<Naira>(existing?.limitMinor ?? naira(100_000));
  const [cadence, setCadence] = useState<Cadence>(existing?.cadence ?? 'monthly');
  const [picked, setPicked] = useState<string | null>(existing?.recipientId ?? null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const recipientId = picked ?? store.contacts[0]?.id ?? '';
  const recipient = recipientId ? store.contact(recipientId) : undefined;
  const nobodySaved = store.status === 'ready' && store.contacts.length === 0 && !recipient;
  const period = cadence === 'weekly' ? 'a week' : 'a month';

  const parts: SentencePart[] = [
    { kind: 'words', text: 'Send ' },
    { kind: 'pill', id: 'amount', text: formatNaira(perRun), tabular: true },
    { kind: 'words', text: ' to ' },
    {
      kind: 'pill',
      id: 'recipient',
      text: recipient?.name ?? 'someone',
      ...(recipient ? { avatar: { initials: recipient.initials, tone: recipient.tone } } : {}),
    },
    { kind: 'words', text: ' ' },
    { kind: 'pill', id: 'cadence', text: cadenceWords(cadence) },
    { kind: 'words', text: ', never more than ' },
    { kind: 'pill', id: 'limit', text: formatNaira(limit), tabular: true },
    { kind: 'words', text: ` ${period}.` },
  ];

  async function save() {
    if (!recipient || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      await store.saveAllowance({
        ...(existing ? { id: existing.id } : {}),
        name: existing?.name ?? `${cadenceWords(cadence)} to ${recipient.name}`,
        recipientId,
        perRunMinor: perRun,
        limitMinor: limit,
        cadence,
      });
      router.back();
    } catch {
      setProblem("We couldn't save that allowance. Nothing has changed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Header title={existing ? 'Edit allowance' : 'New allowance'} />

      <View className="flex-1 px-gutter-lg pt-[18px]">
        <Sentence parts={parts} activeId={slot} onPressPill={(next) => setSlot(next as Slot)} />
        <Text className="mt-[26px] font-body text-note text-slate">Tap any value to change it.</Text>
      </View>

      <View className="flex-none rounded-t-panel border-t border-line bg-card px-gutter pb-3.5 pt-5">
        <SheetGrabber />

        {nobodySaved ? (
          <View>
            <Text className="px-1 font-heavy text-body-sm text-ink">Save someone first</Text>
            <Text className="mt-2 px-1 font-body text-label text-slate">
              An allowance is for one person you have saved. Add them as a beneficiary, then come back.
            </Text>
          </View>
        ) : slot === 'cadence' ? (
          <CadencePicker value={cadence} onChange={setCadence} />
        ) : slot === 'recipient' ? (
          <RecipientPicker contacts={store.contacts} value={recipientId} onChange={setPicked} />
        ) : (
          // Keyed by the slot: each amount keeps its own digits.
          <AmountPad
            key={slot}
            title={slot === 'amount' ? 'How much each time' : `Never more than, ${period}`}
            value={slot === 'amount' ? perRun : limit}
            onChange={slot === 'amount' ? setPerRun : setLimit}
          />
        )}

        <View className="mt-4 flex-row">
          {nobodySaved ? (
            <Button label="Add a beneficiary" onPress={() => router.push('/beneficiaries/new')} />
          ) : (
            <Button
              label={existing ? 'Save allowance' : 'Create allowance'}
              busy={saving}
              disabled={!recipient || perRun <= 0 || limit < perRun}
              onPress={() => void save()}
            />
          )}
        </View>

        {problem ? (
          <Text className="mt-3 text-center font-body text-label-sm text-halt">{problem}</Text>
        ) : !nobodySaved && limit < perRun ? (
          <Text className="mt-3 text-center font-body text-label-sm text-caution">
            The limit has to cover at least one payment.
          </Text>
        ) : null}
      </View>
    </Screen>
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
                  ? 'border-[1.5px] border-ink bg-card py-[13.5px]'
                  : 'border border-hairline bg-paper py-3.5'
              }`}
            >
              <Text
                className={`text-body ${selected ? 'font-strong text-ink' : 'font-body text-slate'}`}
              >
                {sentenceCase(cadenceWords(option))}
              </Text>
              <Text
                className={`text-caption ${
                  selected ? 'font-heavy text-ink' : 'font-strong text-slate'
                }`}
              >
                {selected ? `${cadenceDetail(option)} · selected` : cadenceDetail(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RecipientPicker({
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
              <View className={selected ? 'rounded-pill border-2 border-ink p-0.5' : 'p-0.5'}>
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

function AmountPad({
  title,
  value,
  onChange,
}: {
  title: string;
  value: Naira;
  onChange: (next: Naira) => void;
}) {
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

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
