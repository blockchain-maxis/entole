import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT, draftProblems, isValidDraft, toRecordFields } from '../lib/beneficiary-draft';

describe('a beneficiary draft', () => {
  it('needs a name and nothing else', () => {
    expect(draftProblems(EMPTY_DRAFT)).toEqual({ name: 'Enter their name.' });
    expect(isValidDraft({ ...EMPTY_DRAFT, name: 'Ada Obi' })).toBe(true);
  });

  it('checks bank details only once something is typed there', () => {
    const named = { ...EMPTY_DRAFT, name: 'Ada Obi' };
    expect(draftProblems({ ...named, bankName: 'First Bank' })).toEqual({
      accountNumber: 'Enter the account number.',
    });
    expect(draftProblems({ ...named, accountNumber: '0123456789' })).toEqual({
      bankName: 'Enter the name of the bank.',
    });
    expect(draftProblems({ ...named, bankName: 'X', accountNumber: '12' }).accountNumber).toMatch(/does not look right/);
    expect(isValidDraft({ ...named, bankName: 'First Bank', accountNumber: 'GB29 NWBK 6016 1331 9268 19' })).toBe(true);
  });

  it('writes only what was filled in, trimmed', () => {
    expect(toRecordFields({ ...EMPTY_DRAFT, name: '  Ada Obi ' })).toEqual({ name: 'Ada Obi' });
    expect(
      toRecordFields({
        name: 'Ada Obi',
        nickname: ' Mum ',
        country: 'GB',
        bankName: ' First Bank ',
        accountNumber: '0123456789',
        accountName: '',
      }),
    ).toEqual({
      name: 'Ada Obi',
      nickname: 'Mum',
      country: 'GB',
      bank: { bankName: 'First Bank', accountNumber: '0123456789' },
    });
  });
});
