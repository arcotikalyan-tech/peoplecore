import { describe, expect, it } from 'vitest';
import { indeedFeed, jobPostingJsonLd, type FeedJob } from './job-feed';

const job: FeedJob = {
  requisition_id: '0b9a6a8e-3c1d-4c56-9a52-2f1f4f6f0a11', title: 'Backend <Engineer>', department: 'Engineering', location: 'Pune office', city: 'Pune',
  state_code: 'MH', employment_type: 'permanent', description: 'Build APIs.\nTricky ]]> text & more', posted_at: '2026-10-20T09:30:00Z', organization_name: 'Example & Co',
};
const o = { origin: 'https://hr.example.test', slug: 'example', now: new Date('2026-10-22T00:00:00Z') };

describe('indeedFeed', () => {
  it('writes each published job in Indeed’s XML format with the apply link', () => {
    const xml = indeedFeed([job], o);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<source>')).toBe(true);
    expect(xml).toContain('<publisher><![CDATA[Example & Co]]></publisher>');
    expect(xml).toContain('<lastBuildDate>Thu, 22 Oct 2026 00:00:00 GMT</lastBuildDate>');
    expect(xml).toContain('<title><![CDATA[Backend <Engineer>]]></title>');
    expect(xml).toContain('<date><![CDATA[Tue, 20 Oct 2026 09:30:00 GMT]]></date>');
    expect(xml).toContain(`<url><![CDATA[https://hr.example.test/careers/example/${job.requisition_id}]]></url>`);
    expect(xml).toContain('<city><![CDATA[Pune]]></city>');
    expect(xml).toContain('<state><![CDATA[Maharashtra]]></state>');
    expect(xml).toContain('<jobtype><![CDATA[fulltime]]></jobtype>');
    expect(xml).toContain('<description><![CDATA[Build APIs.<br>Tricky ]]&gt; text &amp; more]]></description>');
    expect(indeedFeed([{ ...job, title: 'A ]]> B' }], o)).toContain('<title><![CDATA[A ]]]]><![CDATA[> B]]></title>');
    expect(xml.trimEnd().endsWith('</source>')).toBe(true);
  });
  it('is still a valid feed with no jobs', () => {
    expect(indeedFeed([], o)).toContain('<publisher><![CDATA[example]]></publisher>');
  });
});

describe('jobPostingJsonLd', () => {
  it('describes the job for Google and cannot close its script element', () => {
    const json = jobPostingJsonLd(job, o);
    expect(json).not.toContain('<');
    const data = JSON.parse(json);
    expect(data).toMatchObject({
      '@type': 'JobPosting', title: 'Backend <Engineer>', datePosted: '2026-10-20', employmentType: 'FULL_TIME', directApply: true,
      hiringOrganization: { name: 'Example & Co' }, jobLocation: { address: { addressLocality: 'Pune', addressRegion: 'Maharashtra', addressCountry: 'IN' } },
    });
  });
});
