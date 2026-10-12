import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, ScanLine } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { countryName } from '@entole/core/countries';
import { formatNaira, kobo } from '@entole/core/money';
import { readRecipient } from '@entole/core/recipient';
import { useStore } from '@entole/core/store';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { cleanNote, resolveSendTarget, sendParamsFor } from '@/lib/recipient';
import { useThemeColors } from '@/lib/theme';

const NOT_SOMEONE = "That doesn't look like a username, a phone number or a pay link.";
const NUMBER_NOT_LINKED = "That number isn't linked to an Entole account yet.";
const NOBODY_BY_THAT_NAME = 'Nobody on Entole has that username.';

/**
 * Who to pay: their username or phone number, or the link they shared. One
 * field, one door — a typed name, a pasted link and a scanned square are read
 * the same way. People you have saved appear underneath as a shortcut when
 * there are any; there is nothing to set up first.
 *
 * A `note` param (from a screen that already knows what the payment is for)
 * travels through to the review sheet's note.
 */
export default function PickRecipient() {
  const router = useRouter();
  const store = useStore();
  const backend = useBackend();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ note?: string }>();
  const note = cleanNote(params.note);

  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveProblem, setResolveProblem] = useState<string | null>(null);

  // A username, a number or a pay link: it names someone, and Continue asks who.
  const sought = useMemo(() => readRecipient(text), [text]);
  const handle = sought?.kind === 'handle' ? sought.handle : null;
  // A link from before usernames says where it goes by itself.
  const target = useMemo(
    () => sendParamsFor(text, note, backend.source.resolveContactId),
    [text, note, backend],
  );
  const typed = text.trim().length > 0;
  const error = typed && !sought && touched ? (resolveProblem ?? NOT_SOMEONE) : resolveProblem;

  const request = sought?.kind === 'handle' ? sought.request : (sought?.checkout ?? null);
  const asked =
    request?.amountMinor !== undefined && request.currency === 'NGN'
      ? formatNaira(kobo(request.amountMinor))
      : null;
  const hint = handle
    ? handle.kind === 'username'
      ? `Continue checks who @${handle.username} is.${asked ? ` The link asks for ${asked}.` : ''}`
      : 'Continue checks whose number that is.'
    : sought
      ? asked
        ? `That checks out. It asks for ${asked}.`
        : 'That checks out.'
      : 'Their username or number is enough. A link they shared works too.';

  async function paste() {
    setPasteNote(null);
    setResolveProblem(null);
    const clip = (await Clipboard.getStringAsync()).trim();
    if (!clip) {
      setPasteNote('There is nothing to paste. Copy their username or link first.');
      return;
    }
    setText(clip);
    setTouched(true);
  }

  async function continueToSend() {
    if (target) {
      router.replace({ pathname: '/send', params: target });
      return;
    }
    if (!handle || resolving) return;
    setResolving(true);
    setResolveProblem(null);
    const result = await resolveSendTarget(text, note, backend);
    setResolving(false);
    if (result === 'unclaimed') {
      return setResolveProblem(handle.kind === 'username' ? NOBODY_BY_THAT_NAME : NUMBER_NOT_LINKED);
    }
    if (!result) return setResolveProblem(NOT_SOMEONE);
    router.replace({ pathname: '/send', params: result });
  }

  const saved = store.status === 'ready' ? store.contacts : [];

  return (
    <Screen>
      <Header title="Send" />

      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 }}
        >
          <Text accessibilityRole="header" className="pt-1 font-display text-heading text-ink">
            Who are you sending to?
          </Text>
          <Text className="mt-2 font-body text-ui text-slate">
            Enter their username or phone number, paste the link they shared, or scan their QR code.
          </Text>

          <View className="mt-5">
            <Field
              label="Username, number or link"
              value={text}
              onChangeText={(next) => {
                setText(next.replace(/\s*\n\s*/g, ''));
                setPasteNote(null);
                setResolveProblem(null);
              }}
              onBlur={() => setTouched(true)}
              placeholder="@username or 0803 123 4567"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              error={error ?? pasteNote}
              hint={hint}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Paste their username or link"
                  hitSlop={10}
                  onPress={() => void paste()}
                  className="ml-3 self-start"
                >
                  <Text className="font-strong text-ui text-ink underline">Paste</Text>
                </Pressable>
              }
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan their QR code"
            onPress={() => router.push({ pathname: '/send/scan', params: note ? { note } : {} })}
            className="mt-3 flex-row items-center gap-3 border-y border-hairline py-3 active:bg-press"
          >
            <View className="h-[42px] w-[42px] items-center justify-center rounded-pill bg-press">
              <ScanLine size={18} strokeWidth={1.6} color={colors.ink} />
            </View>
            <Text className="flex-1 font-strong text-ui text-ink">Scan their QR code</Text>
            <ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />
          </Pressable>

          {saved.length > 0 ? (
            <View>
              <SectionHeading title="Or a beneficiary" />
              <View className="border-t border-hairline">
                {saved.map((item) => {
                  const where = countryName(item.place);
                  return (
                    <ContactRow
                      key={item.id}
                      contact={item}
                      {...(where ? { caption: where } : {})}
                      trailing={<ChevronRight size={16} strokeWidth={1.5} color={colors.mist} />}
                      onPress={() =>
                        router.replace({
                          pathname: '/send',
                          params: { contactId: item.id, ...(note ? { note } : {}) },
                        })
                      }
                    />
                  );
                })}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <ActionBar>
          <Button
            label={resolving ? 'Checking…' : 'Continue'}
            busy={resolving}
            disabled={(!target && !handle) || resolving}
            onPress={() => void continueToSend()}
          />
        </ActionBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}
