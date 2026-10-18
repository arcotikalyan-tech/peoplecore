import { describe, expect, it } from 'vitest';
import { inclusiveLanguageWarnings, MOCK_PROVIDER, receiptExtraction, resumeExtraction, runAgent, textPdf, type RunDeps } from '../src/index.ts';

const deps: RunDeps = {
  provider: MOCK_PROVIDER,
  gate: { begin: async () => 'run', finish: async () => {} },
  port: { org: { id: 'o', name: 'Example Co' }, searchKnowledge: async () => [] },
  can: () => true,
};
const pdf = (lines: string[]) => ({ mediaType: 'application/pdf' as const, data: textPdf(lines).toString('base64') });

describe('textPdf', () => {
  it('writes a well-formed one-page PDF whose cross-reference offsets point at its objects', () => {
    const bytes = textPdf(['Name: Asha (Verma)', 'Total: Rs 1,239.00']);
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(Name: Asha \\(Verma\\)) Tj');
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});

describe('inclusive language check', () => {
  it('flags wording that excludes by age, gender, marital status or origin', () => {
    expect(inclusiveLanguageWarnings('We want a young team player. Male candidates preferred. Unmarried only. Native English speaker.'))
      .toEqual([
        '“young” may exclude people by age; consider rewording.',
        '“Male” may exclude people by gender; consider rewording.',
        '“Unmarried” may exclude people by marital status; consider rewording.',
        '“Native English speaker” may exclude people by origin; consider rewording.',
      ]);
    expect(inclusiveLanguageWarnings('Candidates aged 22 to 30.')).toEqual(['“aged 22” may exclude people by age; consider rewording.']);
  });

  it('leaves ordinary job text alone', () => {
    expect(inclusiveLanguageWarnings('A bachelor’s degree helps. Set up single sign-on. You will work with other teams, the manager and their reports; 3–5 years of experience.')).toEqual([]);
  });
});

describe('document readers with the test provider (browser journeys rely on this)', () => {
  it('reads labelled lines from a generated resume, never protected attributes', async () => {
    const r = await runAgent(resumeExtraction, { file: pdf(['Name: Asha Verma', 'Email: asha@example.test', 'Phone: +91 98450 12345', 'Company: Acme Analytics', 'Gender: Female']) }, deps);
    expect(r).toMatchObject({ ok: true, output: { isResume: true, firstName: 'Asha', lastName: 'Verma', email: 'asha@example.test', phone: '+919845012345', currentCompany: 'Acme Analytics' } });
    expect(JSON.stringify(r)).not.toMatch(/female/i);
  });

  it('reads a generated receipt and picks the organization’s category', async () => {
    const r = await runAgent(receiptExtraction, {
      file: pdf(['Merchant: Cafe Coffee Day', 'Date: 2026-10-12', 'Category: Meals', 'Total: Rs 1,239.00']),
      categories: [{ id: 'c1', name: 'Local conveyance' }, { id: 'c2', name: 'Meals' }], today: '2026-10-18',
    }, deps);
    expect(r).toMatchObject({ ok: true, output: { isReceipt: true, merchant: 'Cafe Coffee Day', date: '2026-10-12', total: 1239, categoryId: 'c2', warnings: [] } });
  });

  it('refuses files that are too big or of another type before any run', async () => {
    let begun = false;
    const d = { ...deps, gate: { begin: async () => { begun = true; return 'run'; }, finish: async () => {} } };
    expect(await runAgent(resumeExtraction, { file: { mediaType: 'text/plain', data: 'aGVsbG8gd29ybGQgaGVsbG8=' } }, d))
      .toMatchObject({ ok: false, reason: 'invalid_input', message: 'Upload a PDF, JPEG, PNG or WebP file' });
    expect(await runAgent(resumeExtraction, { file: { mediaType: 'application/pdf', data: 'A'.repeat(7_000_002) } }, d))
      .toMatchObject({ ok: false, reason: 'invalid_input', message: 'The file is larger than 5 MB' });
    expect(begun).toBe(false);
  });
});
