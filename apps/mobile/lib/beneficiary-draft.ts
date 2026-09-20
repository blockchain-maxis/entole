import type { Beneficiary } from '@entole/core/records';

/**
 * What the add and edit screens hold while someone types. Everything is a
 * string here so a half-typed field is never a type error; `toRecordFields`
 * turns a valid draft into the parts of a record that come from the person
 * (the code, id, tone and date are set by the screen that saves).
 */
export type BeneficiaryDraft = {
  name: string;
  nickname: string;
  country: string | undefined;
  bankName: string;
  accountNumber: string;
  accountName: string;
};

export const EMPTY_DRAFT: BeneficiaryDraft = {
  name: '',
  nickname: '',
  country: undefined,
  bankName: '',
  accountNumber: '',
  accountName: '',
};

export function draftFrom(beneficiary: Beneficiary): BeneficiaryDraft {
  return {
    name: beneficiary.name,
    nickname: beneficiary.nickname ?? '',
    country: beneficiary.country,
    bankName: beneficiary.bank?.bankName ?? '',
    accountNumber: beneficiary.bank?.accountNumber ?? '',
    accountName: beneficiary.bank?.accountName ?? '',
  };
}

export type DraftProblems = {
  name?: string;
  bankName?: string;
  accountNumber?: string;
};

// Account numbers run from short local ones to a 34-character IBAN.
const ACCOUNT_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 -]{2,32}[A-Za-z0-9]$/;

/** Bank details are optional, but half of them is not — and none of it is
 * checked until something is typed there. */
export function draftProblems(draft: BeneficiaryDraft): DraftProblems {
  const problems: DraftProblems = {};
  if (!draft.name.trim()) problems.name = 'Enter their name.';

  const bankTouched = [draft.bankName, draft.accountNumber, draft.accountName].some((value) => value.trim());
  if (bankTouched) {
    if (!draft.bankName.trim()) problems.bankName = 'Enter the name of the bank.';
    if (!draft.accountNumber.trim()) problems.accountNumber = 'Enter the account number.';
    else if (!ACCOUNT_NUMBER.test(draft.accountNumber.trim())) {
      problems.accountNumber = 'That account number does not look right. Use letters and numbers only.';
    }
  }
  return problems;
}

export function isValidDraft(draft: BeneficiaryDraft): boolean {
  return Object.keys(draftProblems(draft)).length === 0;
}

export function toRecordFields(
  draft: BeneficiaryDraft,
): Pick<Beneficiary, 'name' | 'nickname' | 'country' | 'bank'> {
  const bankName = draft.bankName.trim();
  const accountNumber = draft.accountNumber.trim();
  const accountName = draft.accountName.trim();
  const nickname = draft.nickname.trim();
  return {
    name: draft.name.trim(),
    ...(nickname ? { nickname } : {}),
    ...(draft.country ? { country: draft.country } : {}),
    ...(bankName && accountNumber
      ? { bank: { bankName, accountNumber, ...(accountName ? { accountName } : {}) } }
      : {}),
  };
}
