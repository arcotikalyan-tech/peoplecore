import { isStateCode, STATES } from '@peoplecore/shared';

/**
 * Published jobs for job boards: an XML feed in Indeed's format (which most aggregators also read) and Google's
 * JobPosting structured data for each job page. Built from public_job_feed, so only open, published jobs appear.
 */
export interface FeedJob {
  requisition_id: string; title: string; department: string | null; location: string | null; city: string | null; state_code: string | null;
  employment_type: string; description: string | null; posted_at: string; organization_name: string;
}

const INDEED_TYPE: Record<string, string> = { permanent: 'fulltime', contract: 'contract', intern: 'internship', temporary: 'temporary', consultant: 'contract' };
const SCHEMA_TYPE: Record<string, string> = { permanent: 'FULL_TIME', contract: 'CONTRACTOR', intern: 'INTERN', temporary: 'TEMPORARY', consultant: 'CONTRACTOR' };

const stateName = (code: string | null) => (isStateCode(code) ? STATES[code].name : null);
const html = (text: string | null) => (text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
/** Text inside CDATA: drops characters XML 1.0 forbids and keeps "]]>" from ending the section early. */
// eslint-disable-next-line no-control-regex
const cdata = (v: string | null) => `<![CDATA[${(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

export const jobUrl = (origin: string, slug: string, id: string) => `${origin}/careers/${slug}/${id}`;

export function indeedFeed(jobs: FeedJob[], o: { origin: string; slug: string; now: Date }): string {
  const tag = (name: string, value: string | null) => `    <${name}>${cdata(value)}</${name}>`;
  const items = jobs.map((j) => [
    '  <job>',
    tag('title', j.title),
    tag('date', new Date(j.posted_at).toUTCString()),
    tag('referencenumber', j.requisition_id),
    tag('url', jobUrl(o.origin, o.slug, j.requisition_id)),
    tag('company', j.organization_name),
    tag('city', j.city ?? j.location),
    tag('state', stateName(j.state_code)),
    tag('country', 'IN'),
    tag('description', html(j.description || j.title)),
    tag('jobtype', INDEED_TYPE[j.employment_type] ?? 'fulltime'),
    tag('category', j.department),
    '  </job>',
  ].join('\n'));
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<source>',
    `  <publisher>${cdata(jobs[0]?.organization_name ?? o.slug)}</publisher>`,
    `  <publisherurl>${cdata(`${o.origin}/careers/${o.slug}`)}</publisherurl>`,
    `  <lastBuildDate>${o.now.toUTCString()}</lastBuildDate>`,
    ...items,
    '</source>',
    '',
  ].join('\n');
}

/** schema.org JobPosting for a job page, as JSON safe to put inside a <script> element. */
export function jobPostingJsonLd(j: FeedJob, o: { origin: string; slug: string }): string {
  const data = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: j.title,
    description: html(j.description || j.title),
    datePosted: j.posted_at.slice(0, 10),
    employmentType: SCHEMA_TYPE[j.employment_type] ?? 'FULL_TIME',
    identifier: { '@type': 'PropertyValue', name: j.organization_name, value: j.requisition_id },
    hiringOrganization: { '@type': 'Organization', name: j.organization_name, sameAs: `${o.origin}/careers/${o.slug}` },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: j.city ?? j.location ?? undefined, addressRegion: stateName(j.state_code) ?? undefined, addressCountry: 'IN' },
    },
    url: jobUrl(o.origin, o.slug, j.requisition_id),
    directApply: true,
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
