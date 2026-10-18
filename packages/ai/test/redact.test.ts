import { describe, expect, it } from 'vitest';
import { ALL_IDENTIFIERS, redactText, redactValue, type RedactionSummary } from '../src/index.ts';

describe('redaction', () => {
  it('masks Indian identifiers, emails and phone numbers and counts them', () => {
    const summary: RedactionSummary = {};
    const text = 'PAN ABCDE1234F, Aadhaar 2345 6789 0123, IFSC HDFC0001234, account 50100123456789, call +91 98765 43210 or 9123456780, mail a.b@example.test';
    expect(redactText(text, ALL_IDENTIFIERS, summary))
      .toBe('PAN [pan], Aadhaar [aadhaar], IFSC [ifsc], account [bank_account], call [phone] or [phone], mail [email]');
    expect(summary).toEqual({ pan: 1, aadhaar: 1, ifsc: 1, bank_account: 1, phone: 2, email: 1 });
  });

  it('leaves ordinary numbers, dates and amounts alone', () => {
    const text = 'Claim within 30 days, up to Rs 1,000 a day, from 2026-04-01; policy v2; 12 days a year.';
    expect(redactText(text, ALL_IDENTIFIERS)).toBe(text);
  });

  it('masks only the kinds asked for, in nested values', () => {
    const summary: RedactionSummary = {};
    expect(redactValue({ q: 'mail me at x@example.test, PAN ABCDE1234F', n: [1, 'y@example.test'] }, ['email'], summary))
      .toEqual({ q: 'mail me at [email], PAN ABCDE1234F', n: [1, '[email]'] });
    expect(summary).toEqual({ email: 2 });
  });
});
