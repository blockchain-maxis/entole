import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import type { Checkout } from '@entole/core/checkout-link';
import { formatHandle } from '@entole/core/handle';
import { formatNaira, kobo } from '@entole/core/money';
import { findRecipient, readRecipient } from '@entole/core/recipient';
import type { Staff } from '@entole/core/records';

import { AmountSheet } from '@/components/ui/AmountSheet';
import { Button } from '@/components/ui/Button';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { plainMessage } from '@/lib/send';
import { useStaff } from '@/lib/staff';
import { useThemeColors } from '@/lib/theme';

type Cadence = Staff['cadence'];

const CADENCES: { value: Cadence; label: string }[] = [
  { value: null, label: 'No schedule' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const NOT_SOMEONE = "That doesn't look like a username or a phone number.";

/**
 * A person the business pays, by hand: their name and their username or phone
 * number. The directory says who that is; where their pay goes is kept with
 * the record and never shown. Regular pay and how often are only what is
 * filled in for you when you run payroll — nothing is paid on its own.
 *
 * With an `id` param this edits that person, and can remove them.
 */
export default function AddPerson() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const team = useStaff();

  // The form starts from the saved person, so it is only shown once they have loaded.
  if (id && team.status === 'loading') {
    return (
      <Screen>
        <Header title="Edit person" />
        <View className="gap-5 px-gutter-lg pt-2">
          <Skeleton className="h-[74px] w-full rounded-control" />
          <Skeleton className="h-[74px] w-full rounded-control" />
        </View>
      </Screen>
    );
  }

  if (id && !team.staff.some((person) => person.id === id)) {
    return (
      <Screen>
        <Header title="Edit person" />
        <View className="px-gutter-lg pt-4">
          <Text className="font-strong text-ui text-ink">We couldn&apos;t find that person.</Text>
          <Text className="mt-1 font-body text-ui text-slate">They may have been removed from this phone.</Text>
        </View>
      </Screen>
    );
  }

  return <PersonForm key={id ?? 'new'} id={id} staff={team.staff} />;
}

function PersonForm({ id, staff }: { id: string | undefined; staff: Staff[] }) {
  const router = useRouter();
  const colors = useThemeColors();
  const { source, paymentCode, directory } = useBackend();

  const existing = useMemo(() => (id ? staff.find((person) => person.id === id) : undefined), [id, staff]);
  const editing = Boolean(id);

  const [name, setName] = useState(existing?.name ?? '');
  // What they were added by, as it was written. Someone saved before usernames
  // has none: the field starts empty and their account stays as it is.
  const [who, setWho] = useState(existing?.handle ?? '');
  const [found, setFound] = useState<{ text: string; who: Checkout | 'nobody' } | null>(null);
  const [pay, setPay] = useState(existing?.payAmountMinor ?? 0);
  const [cadence, setCadence] = useState<Cadence>(existing?.cadence ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [touched, setTouched] = useState(false);
  const [sheet, setSheet] = useState<'pay' | 'remove' | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const typed = who.trim().length > 0;
  // Left as it was: this is still the person already saved.
  const unchanged = Boolean(existing) && who.trim() === (existing?.handle ?? '');
  const sought = useMemo(() => (unchanged ? null : readRecipient(who)), [unchanged, who]);

  // A username or a number names someone; the directory says who, a moment
  // after typing stops.
  useEffect(() => {
    if (!sought) return;
    let live = true;
    const timer = setTimeout(() => {
      void findRecipient(directory, sought)
        .catch(() => null)
        .then((person) => {
          if (!live) return;
          setFound({ text: who, who: person ?? 'nobody' });
          // Their own name, to keep or change. Never over one already typed.
          if (person?.payee) setName((current) => (current.trim() ? current : person.payee!));
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sought, who, directory]);

  const looked = sought && found?.text === who ? found.who : null;
  const person = looked && looked !== 'nobody' ? looked : null;
  const code = unchanged ? (existing?.code ?? null) : (person?.code ?? null);
  const written = sought?.kind === 'handle' ? formatHandle(sought.handle) : 'that';

  const whoError = useMemo(() => {
    if (unchanged || !typed) return null;
    if (!sought) return touched ? NOT_SOMEONE : null;
    if (looked === 'nobody') return `Nobody on Entole has ${written} yet.`;
    if (!person) return null;
    if (paymentCode && person.code === paymentCode) return "That's you. Add someone you pay.";
    const duplicate = staff.find((entry) => entry.code === person.code && entry.id !== id);
    if (duplicate) return `${duplicate.name} is already on your team.`;
    return null;
  }, [unchanged, typed, sought, touched, looked, written, person, paymentCode, staff, id]);

  const whoHint = person
    ? `That is ${person.payee ?? 'someone on Entole'}.`
    : sought
      ? `Looking for ${written}.`
      : existing && !existing.handle
        ? 'Already saved. Type a username or number only to change who this is.'
        : 'Their username is on Receive in their app.';

  const ready = name.trim().length > 0 && code !== null && !whoError;

  async function paste() {
    const text = await Clipboard.getStringAsync();
    if (!text.trim()) return;
    setWho(text.trim());
    setTouched(true);
  }

  async function save() {
    if (!ready || !code || saving) return;
    const handle = sought?.kind === 'handle' ? formatHandle(sought.handle) : existing?.handle;
    setSaving(true);
    setProblem(null);
    try {
      await source.saveStaff({
        id: existing?.id ?? `st-${Date.now()}`,
        name: name.trim(),
        code,
        ...(handle ? { handle } : {}),
        ...(pay > 0 ? { payAmountMinor: pay } : {}),
        cadence: pay > 0 ? cadence : null,
        ...(note.trim() ? { note: note.trim() } : {}),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      router.back();
    } catch (error) {
      setProblem(plainMessage(error, "We couldn't save that person. Try again."));
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      await source.removeStaff(existing.id);
      router.back();
    } catch (error) {
      setProblem(plainMessage(error, "We couldn't remove them. Try again."));
      setSaving(false);
    }
  }

  return (
    <View className="flex-1">
      <Screen>
        <Header title={editing ? 'Edit person' : 'Add a person'} />

          <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, paddingTop: 4 }}
            >
              <Field
                label="Their name"
                value={name}
                onChangeText={setName}
                placeholder="Ada Okafor"
                autoCapitalize="words"
                returnKeyType="next"
                maxLength={60}
              />

              <View className="mt-5">
                <Field
                  label="Their username or number"
                  value={who}
                  onChangeText={setWho}
                  onBlur={() => setTouched(true)}
                  placeholder="@username or 0803 123 4567"
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={whoError}
                  hint={whoHint}
                  trailing={
                    <Pressable accessibilityRole="button" hitSlop={10} onPress={() => void paste()}>
                      <Text className="font-strong text-ui text-ink underline">Paste</Text>
                    </Pressable>
                  }
                />
              </View>

              <Text className="mt-6 font-strong text-note text-slate">Regular pay</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set regular pay"
                onPress={() => setSheet('pay')}
                className="mt-2 flex-row items-center justify-between rounded-control border-[1.5px] border-line bg-card px-4 py-3.5 active:border-mist"
              >
                <Text tabular className={`font-strong text-prose ${pay > 0 ? 'text-ink' : 'text-slate'}`}>
                  {pay > 0 ? formatNaira(kobo(pay)) : 'Optional'}
                </Text>
                <ChevronRight size={18} strokeWidth={1.5} color={colors.mist} />
              </Pressable>
              <Text className="mt-2 font-body text-note text-slate">
                Filled in for you when you run payroll. You can change it each time.
              </Text>

              {pay > 0 ? (
                <View className="mt-5">
                  <Text className="font-strong text-note text-slate">How often</Text>
                  <View className="mt-2 flex-row gap-2">
                    {CADENCES.map((option) => {
                      const selected = option.value === cadence;
                      return (
                        <Pressable
                          key={option.label}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setCadence(option.value)}
                          className={`flex-1 items-center rounded-control py-3 ${
                            selected ? 'border-[1.5px] border-ink bg-card' : 'border border-line bg-card'
                          }`}
                        >
                          <Text className={`text-ui ${selected ? 'font-strong text-ink' : 'font-body text-slate'}`}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text className="mt-2 font-body text-note text-slate">
                    A reminder for you. Nothing is paid automatically.
                  </Text>
                </View>
              ) : null}

              <View className="mt-6">
                <Field
                  label="Note"
                  optional
                  value={note}
                  onChangeText={setNote}
                  placeholder="Cashier, Ikeja branch"
                  autoCapitalize="sentences"
                  maxLength={80}
                />
              </View>

              {problem ? <Text className="mt-4 font-body text-note text-halt">{problem}</Text> : null}

              {existing ? (
                <View className="mt-8 flex-row">
                  <Button
                    label="Remove from team"
                    variant="danger-outline"
                    width="hug"
                    onPress={() => {
                      setProblem(null);
                      setSheet('remove');
                    }}
                  />
                </View>
              ) : null}
            </ScrollView>
        </KeyboardAvoidingView>

        <ActionBar>
          <Button
            label={editing ? 'Save changes' : 'Add to team'}
            busy={saving && sheet !== 'remove'}
            disabled={!ready}
            onPress={() => void save()}
          />
        </ActionBar>
      </Screen>

      {sheet === 'pay' ? (
        <AmountSheet
          title="Regular pay"
          hint="What you usually pay them each time."
          current={pay}
          onSet={(next) => {
            setPay(next);
            setSheet(null);
          }}
          onClear={() => {
            setPay(0);
            setCadence(null);
            setSheet(null);
          }}
          onDismiss={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'remove' && existing ? (
        <ConfirmSheet
          title={`Remove ${existing.name}?`}
          body="They come off your team list. Payments you already made stay in your activity."
          confirmLabel="Remove"
          tone="danger"
          busy={saving}
          problem={problem}
          onConfirm={() => void remove()}
          onDismiss={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}
