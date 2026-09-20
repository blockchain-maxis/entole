import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScanLine } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';

import { parseCheckout } from '@entole/core/checkout-link';
import { countryName } from '@entole/core/countries';
import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Header } from '@/components/ui/Header';
import { ContactRow, SectionHeading } from '@/components/ui/Rows';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { cleanNote, sendParamsFor } from '@/lib/recipient';
import { useThemeColors } from '@/lib/theme';

const BAD_CODE = "That code doesn't look right — check it and try again.";
/** A payment code is PAY plus 36 characters. Past that many, a code that still
 * does not read is wrong, and there is no point waiting for the field to blur. */
const COMPLETE_CODE_LENGTH = 39;

/**
 * Who to pay: their code, or the link they shared. One field, one door — a
 * pasted link, a scanned QR and a typed code are read the same way. People you
 * have saved appear underneath as a shortcut when there are any; there is
 * nothing to set up first.
 *
 * A `note` param (from a screen that already knows what the payment is for)
 * travels through to the review sheet's note.
 */
export default function PickRecipient() {
  const router = useRouter();
  const store = useStore();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ note?: string }>();
  const note = cleanNote(params.note);

  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const parsed = useMemo(() => parseCheckout(text), [text]);
  const target = useMemo(() => sendParamsFor(text, note), [text, note]);
  const typed = text.trim().length > 0;
  const looksComplete = text.replace(/[^0-9a-z]/gi, '').length >= COMPLETE_CODE_LENGTH;
  const error = typed && !parsed && (touched || looksComplete) ? BAD_CODE : null;

  const asked =
    parsed?.amountMinor !== undefined && parsed.currency === 'NGN'
      ? formatNaira(kobo(parsed.amountMinor))
      : null;
  const hint = parsed
    ? asked
      ? `That checks out. It asks for ${asked}.`
      : 'That checks out.'
    : 'Paste a link or type a code. Dashes and capitals do not matter.';

  async function paste() {
    setPasteNote(null);
    const clip = (await Clipboard.getStringAsync()).trim();
    if (!clip) {
      setPasteNote('There is nothing to paste. Copy their code or link first.');
      return;
    }
    setText(clip);
    setTouched(true);
  }

  const saved = store.status === 'ready' ? store.contacts : [];

  return (
    <Screen>
      <Header title="Who are you sending to?" />

      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 }}
        >
          <Text className="font-body text-body-sm text-slate">
            Enter their code, paste the link they shared, or scan their QR code.
          </Text>

          <View className="mt-5">
            <Field
              label="Their code or link"
              value={text}
              onChangeText={(next) => {
                setText(next.replace(/\s*\n\s*/g, ''));
                setPasteNote(null);
              }}
              onBlur={() => setTouched(true)}
              placeholder="PAY-XXXX-XXXX-XXXX"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              error={error ?? pasteNote}
              hint={hint}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Paste their code or link"
                  hitSlop={10}
                  onPress={() => void paste()}
                  className="ml-3 self-start"
                >
                  <Text className="font-strong text-label text-indigo">Paste</Text>
                </Pressable>
              }
            />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan their QR code"
            onPress={() => router.push({ pathname: '/send/scan', params: note ? { note } : {} })}
            className="mt-3 flex-row items-center gap-3 rounded-control border border-line bg-card px-4 py-3 active:border-mist"
          >
            <View className="h-9 w-9 items-center justify-center rounded-pill bg-indigo-wash">
              <ScanLine size={18} strokeWidth={1.6} color={colors.indigo.DEFAULT} />
            </View>
            <Text className="font-strong text-body-sm text-ink">Scan their QR code</Text>
          </Pressable>

          {saved.length > 0 ? (
            <View className="mt-8">
              <SectionHeading title="Or choose someone you’ve saved" />
              <View className="gap-2">
                {saved.map((item) => {
                  const where = countryName(item.place);
                  return (
                    <ContactRow
                      key={item.id}
                      contact={item}
                      {...(where ? { caption: where } : {})}
                      trailing={<Text className="font-strong text-caption-sm text-indigo">Send</Text>}
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
            label="Continue"
            disabled={!target}
            onPress={() => {
              if (target) router.replace({ pathname: '/send', params: target });
            }}
          />
        </ActionBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}
