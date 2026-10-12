import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import type { Checkout } from '@entole/core/checkout-link';
import { formatHandle } from '@entole/core/handle';
import { oneOffAddress } from '@entole/core/one-off';
import { findRecipient, readRecipient } from '@entole/core/recipient';
import { beneficiarySchema, type Beneficiary } from '@entole/core/records';
import { suggestedNameFor } from '@entole/core/save-recipient';
import { useStore } from '@entole/core/store';

import { BeneficiaryForm } from '@/components/ui/BeneficiaryForm';
import { Button } from '@/components/ui/Button';
import { CountrySheet } from '@/components/ui/CountryPicker';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import {
  EMPTY_DRAFT,
  draftProblems,
  toRecordFields,
  type BeneficiaryDraft,
} from '@/lib/beneficiary-draft';

const NOT_SOMEONE = "That doesn't look like a username or a phone number.";

/**
 * Add someone by their username or their phone number. It is typed or pasted,
 * the directory says who it is, and their name is filled in to be kept or
 * changed. Where their money goes is held only long enough to save the record;
 * nothing here renders it.
 *
 * `recipient` is someone just paid, handed over from the send screen or a
 * receipt: they are already known, so nothing is asked for but what to call
 * them. `next=send` carries the person straight on to paying the beneficiary
 * they just added; otherwise this goes back to where they came from.
 */
export default function NewBeneficiary() {
  const router = useRouter();
  const store = useStore();
  const { source, directory } = useBackend();
  const { account } = useAccount();
  const { next, recipient } = useLocalSearchParams<{ next?: string; recipient?: string }>();

  // Someone just paid: who they are travels in the id, never as text on a screen.
  const paid = useMemo(() => {
    const address = recipient ? oneOffAddress(recipient) : null;
    return address && recipient ? { address, name: suggestedNameFor(recipient) } : null;
  }, [recipient]);

  const [who, setWho] = useState('');
  const [whoTouched, setWhoTouched] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [found, setFound] = useState<{ text: string; who: Checkout | 'nobody' } | null>(null);
  const [draft, setDraft] = useState<BeneficiaryDraft>(() => ({ ...EMPTY_DRAFT, name: paid?.name ?? '' }));
  const [pickingCountry, setPickingCountry] = useState(false);
  const [existing, setExisting] = useState<Beneficiary[]>([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source
      .listBeneficiaries()
      .then((list) => live && setExisting(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [source]);

  // A username or a number names someone; the directory says who, a moment
  // after typing stops.
  const sought = useMemo(() => (paid ? null : readRecipient(who)), [paid, who]);
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
          if (person?.payee) setDraft((current) => (current.name.trim() ? current : { ...current, name: person.payee! }));
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sought, who, directory]);

  const looked = sought && found?.text === who ? found.who : null;
  const person = looked && looked !== 'nobody' ? looked : null;
  const address = paid?.address ?? person?.address ?? null;

  const own = address !== null && account?.owner.viemAccount.address.toLowerCase() === address.toLowerCase();
  const duplicate = useMemo(
    () => (address ? existing.find((entry) => entry.address.toLowerCase() === address.toLowerCase()) : undefined),
    [address, existing],
  );

  const problems = draftProblems(draft);
  const typed = who.trim().length > 0;
  const written = sought?.kind === 'handle' ? formatHandle(sought.handle) : 'that';
  const whoError = own
    ? "That's you. Add someone else."
    : duplicate
      ? `You already have ${duplicate.nickname ?? duplicate.name} as a beneficiary.`
      : looked === 'nobody'
        ? `Nobody on Entole has ${written} yet.`
        : typed && !sought && whoTouched
          ? NOT_SOMEONE
          : null;
  const whoOk = address !== null && !own && !duplicate;
  const whoHint = person
    ? `That is ${person.payee ?? 'someone on Entole'}.`
    : sought
      ? `Looking for ${written}.`
      : 'Their username, like @ada.eze, or their phone number.';

  const blocker = !whoOk
    ? paid
      ? whoError
      : 'Enter their username or number to continue.'
    : (problems.name ?? problems.bankName ?? problems.accountNumber ?? null);

  async function paste() {
    setPasteNote(null);
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      setPasteNote('There is nothing to paste. Copy their username or link first.');
      return;
    }
    setWho(text);
    setWhoTouched(true);
  }

  async function save() {
    if (!whoOk || address === null || blocker || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      // The list is read again here: it is the authority on duplicates, and
      // its length picks this person's avatar tone.
      const current = await source.listBeneficiaries();
      const clash = current.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
      if (clash) {
        setExisting(current);
        return;
      }

      const parsed = beneficiarySchema.safeParse({
        id: randomUUID(),
        ...toRecordFields(draft),
        address,
        tone: (current.length % 3) + 1,
        createdAt: new Date().toISOString(),
      });
      if (!parsed.success) {
        setProblem('Check the details and try again.');
        return;
      }

      await source.saveBeneficiary(parsed.data);
      await store.refresh().catch(() => undefined);

      if (next === 'send') router.replace({ pathname: '/send', params: { contactId: parsed.data.id } });
      else if (router.canGoBack()) router.back();
      else router.replace('/beneficiaries');
    } catch {
      setProblem("We couldn't save that beneficiary. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Add a beneficiary" />

        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 22 }}
          >
            {paid ? (
              <Text className="font-body text-ui text-slate">
                {paid.name
                  ? `Save ${paid.name} and you can pay them again in a couple of taps.`
                  : 'Save the person you just paid and you can pay them again in a couple of taps.'}
              </Text>
            ) : (
              <>
                <Text className="font-body text-ui text-slate">
                  Ask them for their username. It is on Receive in their app. Their phone number works too.
                </Text>

                <Field
                  label="Username or number"
                  value={who}
                  onChangeText={(text) => {
                    setWho(text.replace(/\s*\n\s*/g, ' '));
                    setPasteNote(null);
                  }}
                  onBlur={() => setWhoTouched(true)}
                  placeholder="@username or 0803 123 4567"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!saving}
                  error={whoError ?? pasteNote}
                  hint={whoHint}
                  trailing={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Paste their username"
                      hitSlop={10}
                      onPress={() => void paste()}
                      className="ml-3 self-start"
                    >
                      <Text className="font-strong text-ui text-ink underline">Paste</Text>
                    </Pressable>
                  }
                />
              </>
            )}

            <BeneficiaryForm
              draft={draft}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              onPickCountry={() => setPickingCountry(true)}
              disabled={saving}
            />
          </ScrollView>

          <View className="flex-none border-t border-hairline px-gutter pb-2.5 pt-3">
            {problem ? (
              <Text className="pb-2.5 text-center font-body text-note text-halt">{problem}</Text>
            ) : blocker ? (
              <Text className="pb-2.5 text-center font-body text-note text-slate">{blocker}</Text>
            ) : null}
            <View className="flex-row">
              <Button
                label={saving ? 'Saving' : 'Save beneficiary'}
                busy={saving}
                disabled={Boolean(blocker)}
                onPress={() => void save()}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Screen>

      {pickingCountry ? (
        <CountrySheet
          value={draft.country}
          onDismiss={() => setPickingCountry(false)}
          onPick={(country) => {
            setDraft((current) => ({ ...current, country }));
            setPickingCountry(false);
          }}
        />
      ) : null}
    </View>
  );
}
