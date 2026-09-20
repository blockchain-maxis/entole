import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { decodePaymentCode } from '@entole/core/payment-code';
import { beneficiarySchema, type Beneficiary } from '@entole/core/records';
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

const BAD_CODE = "That code doesn't look right — check it and try again.";

/**
 * Add someone by their payment code. The code is pasted or typed — there is no
 * camera step — and it is checked before anything else is asked. The address
 * inside it is held only long enough to save the record; nothing here renders
 * it.
 *
 * `next=send` carries the person straight on to paying the beneficiary they
 * just added; otherwise this goes back to where they came from.
 */
export default function NewBeneficiary() {
  const router = useRouter();
  const store = useStore();
  const { source, paymentCode } = useBackend();
  const { account } = useAccount();
  const { next, code: presetCode } = useLocalSearchParams<{ next?: string; code?: string }>();

  // `code` pre-fills the field when saving someone just paid by their code.
  const [code, setCode] = useState(presetCode ?? '');
  const [codeTouched, setCodeTouched] = useState(Boolean(presetCode));
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<BeneficiaryDraft>(EMPTY_DRAFT);
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

  const decoded = useMemo(() => (code.trim() ? decodePaymentCode(code) : null), [code]);
  const own = useMemo(() => {
    const mine = [paymentCode ? decodePaymentCode(paymentCode) : null, account?.owner.viemAccount.address ?? null];
    return decoded !== null && mine.some((address) => address?.toLowerCase() === decoded.toLowerCase());
  }, [account, decoded, paymentCode]);
  const duplicate = useMemo(
    () => (decoded ? existing.find((entry) => entry.address.toLowerCase() === decoded.toLowerCase()) : undefined),
    [decoded, existing],
  );

  const problems = draftProblems(draft);
  const codeError = !code.trim()
    ? null
    : own
      ? "That's your own payment code. Add someone else."
      : duplicate
        ? `You already have ${duplicate.nickname ?? duplicate.name} as a beneficiary.`
        : decoded === null && codeTouched
          ? BAD_CODE
          : null;
  const codeOk = decoded !== null && !own && !duplicate;

  const blocker = !codeOk
    ? 'Enter their payment code to continue.'
    : (problems.name ?? problems.bankName ?? problems.accountNumber ?? null);

  async function paste() {
    setPasteNote(null);
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      setPasteNote('There is nothing to paste. Copy their payment code first.');
      return;
    }
    setCode(text);
    setCodeTouched(true);
  }

  async function save() {
    if (!codeOk || decoded === null || blocker || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      // The list is read again here: it is the authority on duplicates, and
      // its length picks this person's avatar tone.
      const current = await source.listBeneficiaries();
      const clash = current.find((entry) => entry.address.toLowerCase() === decoded.toLowerCase());
      if (clash) {
        setExisting(current);
        return;
      }

      const parsed = beneficiarySchema.safeParse({
        id: randomUUID(),
        ...toRecordFields(draft),
        address: decoded,
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
            <Text className="font-body text-body-sm text-slate">
              Ask them for their payment code. They can share it from Receive in their app.
            </Text>

            <Field
              label="Payment code"
              value={code}
              onChangeText={(text) => {
                setCode(text.replace(/\s*\n\s*/g, ' '));
                setPasteNote(null);
              }}
              onBlur={() => setCodeTouched(true)}
              placeholder="PAY-XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect={false}
              multiline
              editable={!saving}
              error={codeError ?? pasteNote}
              hint={codeOk ? 'That code checks out.' : 'Paste it or type it. Dashes and capitals do not matter.'}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Paste the payment code"
                  hitSlop={10}
                  onPress={() => void paste()}
                  className="ml-3 self-start"
                >
                  <Text className="font-strong text-label text-indigo">Paste</Text>
                </Pressable>
              }
            />

            <BeneficiaryForm
              draft={draft}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              onPickCountry={() => setPickingCountry(true)}
              disabled={saving}
            />
          </ScrollView>

          <View className="flex-none border-t border-hairline px-gutter pb-2.5 pt-3">
            {problem ? (
              <Text className="pb-2.5 text-center font-body text-label-sm text-halt">{problem}</Text>
            ) : blocker ? (
              <Text className="pb-2.5 text-center font-body text-label-sm text-slate">{blocker}</Text>
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
