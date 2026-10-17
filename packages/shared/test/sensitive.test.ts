import { describe, expect, it } from 'vitest';
import { bankAccountSchema, fieldErrors, identitySchema, personalDetailsSchema } from '../src/index.ts';

describe('identitySchema', () => {
  it('normalises spacing and case, and treats blanks as not provided', () => {
    expect(identitySchema.parse({ pan: ' abcpe1234f ', uan: '1001 2345 6789', aadhaarLast4: '', esicNumber: '31-0012345678' })).toEqual({
      pan: 'ABCPE1234F', uan: '100123456789', aadhaarLast4: undefined, esicNumber: '310012345678',
      passportNumber: undefined, passportExpiry: undefined,
    });
  });

  it('requires an individual PAN (P as the 4th character)', () => {
    const r = identitySchema.safeParse({ pan: 'ABCDE1234F' });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).pan).toMatch(/4th character/);
  });

  it('accepts only the last 4 Aadhaar digits, never a full number', () => {
    expect(identitySchema.safeParse({ aadhaarLast4: '1234' }).success).toBe(true);
    expect(identitySchema.safeParse({ aadhaarLast4: '1234 5678 9012' }).success).toBe(false);
  });
});

describe('bankAccountSchema', () => {
  const base = { accountHolderName: 'Asha Rao', bankName: 'Demo Bank', accountNumber: '0012 3456 7890', confirmAccountNumber: '001234567890', ifsc: 'demb0001234', accountType: 'savings' };

  it('normalises the account number and IFSC', () => {
    expect(bankAccountSchema.parse(base)).toMatchObject({ accountNumber: '001234567890', ifsc: 'DEMB0001234' });
  });

  it('rejects mismatched confirmation and malformed IFSC', () => {
    const mismatch = bankAccountSchema.safeParse({ ...base, confirmAccountNumber: '001234567891' });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) expect(fieldErrors(mismatch.error)).toHaveProperty('confirmAccountNumber');
    expect(bankAccountSchema.safeParse({ ...base, ifsc: 'DEMB1001234' }).success).toBe(false);
  });
});

describe('personalDetailsSchema', () => {
  it('rejects a date of birth in the future', () => {
    expect(personalDetailsSchema.safeParse({ dateOfBirth: '2999-01-01' }).success).toBe(false);
    expect(personalDetailsSchema.parse({ dateOfBirth: '1990-05-05', gender: '' })).toMatchObject({ dateOfBirth: '1990-05-05', gender: undefined });
  });
});
