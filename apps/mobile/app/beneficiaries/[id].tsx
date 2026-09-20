import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { toContact, type Beneficiary } from '@entole/core/records';
import { useStore } from '@entole/core/store';

import { Avatar } from '@/components/ui/Avatar';
import { BeneficiaryForm } from '@/components/ui/BeneficiaryForm';
import { Button } from '@/components/ui/Button';
import { CountrySheet } from '@/components/ui/CountryPicker';
import { Header } from '@/components/ui/Header';
import { Screen } from '@/components/ui/Screen';
import { Sheet, SheetLayer } from '@/components/ui/Sheet';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import {
  draftFrom,
  draftProblems,
  toRecordFields,
  type BeneficiaryDraft,
} from '@/lib/beneficiary-draft';

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; beneficiary: Beneficiary };

/**
 * Edit a beneficiary's name, nickname, country and bank details, or remove
 * them. Their payment code is not shown or changed here: a different code is a
 * different person, so that is a new beneficiary.
 */
export default function EditBeneficiary() {
  const router = useRouter();
  const store = useStore();
  const { source } = useBackend();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [draft, setDraft] = useState<BeneficiaryDraft | null>(null);
  const [pickingCountry, setPickingCountry] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState<'saving' | 'removing' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    source
      .listBeneficiaries()
      .then((list) => {
        if (!live) return;
        const found = list.find((entry) => entry.id === id);
        if (!found) return setLoad({ state: 'missing' });
        setLoad({ state: 'ready', beneficiary: found });
        setDraft(draftFrom(found));
      })
      .catch(() => live && setLoad({ state: 'missing' }));
    return () => {
      live = false;
    };
  }, [id, source]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/beneficiaries'));

  const problems = draft ? draftProblems(draft) : {};
  const blocker = problems.name ?? problems.bankName ?? problems.accountNumber ?? null;

  // A beneficiary an allowance pays cannot vanish from under it.
  const inUse =
    store.allowances.some((allowance) => allowance.recipientId === id) ||
    store.seats.some((seat) => seat.recipientId === id);

  async function save() {
    if (load.state !== 'ready' || !draft || blocker || busy) return;
    setBusy('saving');
    setProblem(null);
    try {
      const { beneficiary } = load;
      await source.saveBeneficiary({
        id: beneficiary.id,
        address: beneficiary.address,
        tone: beneficiary.tone,
        createdAt: beneficiary.createdAt,
        ...toRecordFields(draft),
      });
      await store.refresh().catch(() => undefined);
      close();
    } catch {
      setProblem("We couldn't save your changes. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (load.state !== 'ready' || inUse || busy) return;
    setBusy('removing');
    setProblem(null);
    try {
      await source.removeBeneficiary(load.beneficiary.id);
      await store.refresh().catch(() => undefined);
      close();
    } catch {
      setProblem("We couldn't remove them. Nothing was changed. Try again.");
      setConfirmingRemove(false);
    } finally {
      setBusy(null);
    }
  }

  const shownName = load.state === 'ready' ? toContact(load.beneficiary).name : '';

  return (
    <View className="flex-1">
      <Screen>
        <Header title="Edit beneficiary" />

        {load.state === 'loading' ? (
          <View className="gap-2 px-gutter">
            <RowSkeleton />
            <RowSkeleton />
          </View>
        ) : load.state === 'missing' || !draft ? (
          <View className="flex-1 items-center justify-center px-gutter-lg">
            <Text className="text-center font-body text-body-sm text-slate">
              That beneficiary is no longer here. They may have been removed.
            </Text>
            <View className="mt-5 flex-row">
              <Button label="Back to beneficiaries" variant="secondary" width="hug" onPress={close} />
            </View>
          </View>
        ) : (
          <KeyboardAvoidingView behavior="padding" className="flex-1">
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, gap: 22 }}
            >
              <View className="items-center pt-1">
                <Avatar
                  initials={toContact(load.beneficiary).initials}
                  tone={load.beneficiary.tone}
                  size="xl"
                />
              </View>

              <BeneficiaryForm
                draft={draft}
                onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
                onPickCountry={() => setPickingCountry(true)}
                disabled={busy !== null}
              />

              <Button
                label="Remove beneficiary"
                variant="danger-outline"
                disabled={busy !== null}
                onPress={() => setConfirmingRemove(true)}
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
                  label={busy === 'saving' ? 'Saving' : 'Save changes'}
                  busy={busy === 'saving'}
                  disabled={Boolean(blocker) || busy !== null}
                  onPress={() => void save()}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </Screen>

      {pickingCountry && draft ? (
        <CountrySheet
          value={draft.country}
          onDismiss={() => setPickingCountry(false)}
          onPick={(country) => {
            setDraft((current) => (current ? { ...current, country } : current));
            setPickingCountry(false);
          }}
        />
      ) : null}

      {confirmingRemove ? (
        <SheetLayer>
          <Sheet onDismiss={() => setConfirmingRemove(false)} locked={busy === 'removing'}>
            <Text className="font-strong text-title text-ink">Remove {shownName}?</Text>
            {inUse ? (
              <Text className="mt-2 font-body text-body-sm text-slate">
                An allowance or seat pays {shownName}. Remove or change that first, then you can remove them here.
              </Text>
            ) : (
              <Text className="mt-2 font-body text-body-sm text-slate">
                They will no longer appear when you send money. Payments you have already made stay in your activity.
              </Text>
            )}
            <View className="mt-6 gap-2.5">
              <View className="flex-row">
                <Button
                  label={busy === 'removing' ? 'Removing' : 'Remove'}
                  variant="destructive"
                  busy={busy === 'removing'}
                  disabled={inUse}
                  onPress={() => void remove()}
                />
              </View>
              <View className="flex-row">
                <Button
                  label="Keep"
                  variant="secondary"
                  disabled={busy === 'removing'}
                  onPress={() => setConfirmingRemove(false)}
                />
              </View>
            </View>
          </Sheet>
        </SheetLayer>
      ) : null}
    </View>
  );
}
