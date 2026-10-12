import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import type { Checkout } from '@entole/core/checkout-link';
import { formatHandle } from '@entole/core/handle';
import { oneOffAddress } from '@entole/core/one-off';
import { initialsFor } from '@entole/core/profile';
import { findRecipient, readRecipient } from '@entole/core/recipient';
import { beneficiarySchema, type Beneficiary } from '@entole/core/records';
import { suggestedNameFor } from '@entole/core/save-recipient';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';

const NOT_SOMEONE = "That doesn't look like a username or a phone number.";
const NAME_MAX = 60;

/**
 * Add someone by their username or their phone number. It is typed or pasted,
 * and the directory says who it is. Their name is already theirs, so it is
 * shown, not asked for. The one thing the person may add is a nickname: what
 * they call them. Where their money goes is held only long enough to save the
 * record; nothing here renders it.
 *
 * `recipient` is someone just paid, handed over from the send screen or a
 * receipt: they are already known, so there is nothing to look up. `next=send`
 * carries the person straight on to paying the beneficiary they just added;
 * otherwise this goes back to where they came from.
 *
 * Where they live and a bank account to keep on file can be added afterwards,
 * from the beneficiary's own page. Asking for them here made saving someone a
 * form.
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
  const [nickname, setNickname] = useState('');
  // Only ever asked for when nothing has named them: a link from before usernames.
  const [typedName, setTypedName] = useState('');
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
          if (live) setFound({ text: who, who: person ?? 'nobody' });
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
  const knownName = (paid?.name || person?.payee || '').trim();
  const name = knownName || typedName.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

  const own = address !== null && account?.owner.viemAccount.address.toLowerCase() === address.toLowerCase();
  const duplicate = useMemo(
    () => (address ? existing.find((entry) => entry.address.toLowerCase() === address.toLowerCase()) : undefined),
    [address, existing],
  );

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
  const whoHint = sought && !person ? `Looking for ${written}.` : 'Their username, like @ada.eze, or their phone number.';

  const blocker = !whoOk
    ? paid
      ? whoError
      : 'Enter their username or number to continue.'
    : name
      ? null
      : 'Enter their name.';

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

      const called = nickname.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      const parsed = beneficiarySchema.safeParse({
        id: randomUUID(),
        name,
        ...(called && called !== name ? { nickname: called } : {}),
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

  const known = whoOk && address !== null;

  return (
    <Screen>
      <Header title="Save a beneficiary" />

      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 22 }}
        >
          {paid ? null : (
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

          {known && knownName ? (
            <View className="flex-row items-center gap-3 border-y border-hairline py-4">
              <Avatar initials={initialsFor(knownName)} tone={((existing.length % 3) + 1) as 1 | 2 | 3} />
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="font-strong text-prose text-ink">
                  {knownName}
                </Text>
                {person?.username ? (
                  <Text numberOfLines={1} className="font-body text-note text-slate">
                    @{person.username}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {known && !knownName ? (
            <Field
              label="Name"
              value={typedName}
              onChangeText={setTypedName}
              placeholder="Their full name"
              autoCapitalize="words"
              autoComplete="name"
              returnKeyType="next"
              maxLength={NAME_MAX}
              editable={!saving}
            />
          ) : null}

          {known ? (
            <Field
              label="Nickname"
              optional
              value={nickname}
              onChangeText={setNickname}
              placeholder="What you call them"
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={NAME_MAX}
              editable={!saving}
              hint="If you add one, it is what you see when you pay them."
            />
          ) : null}
        </ScrollView>

        <View className="flex-none border-t border-hairline px-gutter pb-2.5 pt-3">
          {problem ? (
            <Text className="pb-2.5 text-center font-body text-note text-halt">{problem}</Text>
          ) : blocker ? (
            <Text className="pb-2.5 text-center font-body text-note text-slate">{blocker}</Text>
          ) : null}
          <View className="flex-row">
            <Button
              label={saving ? 'Saving' : 'Save'}
              busy={saving}
              disabled={Boolean(blocker)}
              onPress={() => void save()}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
