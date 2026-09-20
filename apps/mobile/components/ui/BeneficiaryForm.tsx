import { View } from 'react-native';

import type { BeneficiaryDraft } from '@/lib/beneficiary-draft';

import { CountryField } from './CountryPicker';
import { Field } from './Field';
import { Text } from './Text';

/**
 * The fields shared by adding and editing a beneficiary: who they are, where
 * they are, and — optionally — the bank account to keep on file. The screen
 * owns the draft, and owns the country sheet (`onPickCountry` asks it to open).
 */
export function BeneficiaryForm({
  draft,
  onChange,
  onPickCountry,
  disabled = false,
}: {
  draft: BeneficiaryDraft;
  onChange: (patch: Partial<BeneficiaryDraft>) => void;
  onPickCountry: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-5">
      <Field
        label="Name"
        value={draft.name}
        onChangeText={(name) => onChange({ name })}
        placeholder="Their full name"
        autoCapitalize="words"
        autoComplete="name"
        returnKeyType="next"
        editable={!disabled}
      />
      <Field
        label="Nickname"
        optional
        value={draft.nickname}
        onChangeText={(nickname) => onChange({ nickname })}
        placeholder="What you call them"
        autoCapitalize="words"
        returnKeyType="next"
        editable={!disabled}
        hint="If you add one, it is what you see when you pay them."
      />
      <CountryField value={draft.country} onPress={onPickCountry} />

      <View className="mt-1 rounded-tile border border-line bg-card px-4 pb-5 pt-4">
        <View className="flex-row items-baseline justify-between">
          <Text className="font-heavy text-body-sm text-ink">Bank details</Text>
          <Text className="font-body text-caption text-mist">Optional</Text>
        </View>
        <Text className="mt-1 font-body text-label-sm text-slate">
          Saved for when bank payouts open. Nothing uses them to send money yet.
        </Text>
        <View className="mt-4 gap-4">
          <Field
            label="Bank name"
            value={draft.bankName}
            onChangeText={(bankName) => onChange({ bankName })}
            placeholder="Name of the bank"
            autoCapitalize="words"
            returnKeyType="next"
            editable={!disabled}
          />
          <Field
            label="Account number"
            value={draft.accountNumber}
            onChangeText={(accountNumber) => onChange({ accountNumber })}
            placeholder="Account number"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="next"
            editable={!disabled}
          />
          <Field
            label="Account holder"
            optional
            value={draft.accountName}
            onChangeText={(accountName) => onChange({ accountName })}
            placeholder="Name on the account"
            autoCapitalize="words"
            returnKeyType="done"
            editable={!disabled}
          />
        </View>
      </View>
    </View>
  );
}
