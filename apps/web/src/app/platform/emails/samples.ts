import { ACCOUNT_EMAILS, type AccountEmailKey, type EmailMessage, type EmailValues } from '@peoplecore/shared';

/** Example values for previews and test emails (never real people: CLAUDE.md). */
export const SAMPLE_ORGANIZATION = 'Acme Technologies';

export function sampleValues(key: AccountEmailKey, email: string, brand: string, origin: string): { values: EmailValues; link: string | null; code: string | null } {
  return {
    values: { organization: SAMPLE_ORGANIZATION, inviter: 'Ravi Kumar', email, new_email: 'new.address@example.test', code: '482915', brand },
    link: ACCOUNT_EMAILS[key].link ? `${origin || 'https://example.test'}/auth/callback?type=${key}&example=1` : null,
    code: key === 'reauthentication' ? '482915' : null,
  };
}

/** A notification as the worker sends it: the app's own words in the shared layout. */
export function sampleMessage(brand: string, origin: string): EmailMessage {
  return {
    subject: 'Leave approved: Casual leave, 12–13 Nov',
    heading: 'Leave approved: Casual leave, 12–13 Nov',
    body: 'Your Casual leave from 12 Nov to 13 Nov (2 days) was approved by Ravi Kumar.\n\nComment: Enjoy the break!',
    button: { label: `Open in ${brand}`, url: `${origin || 'https://example.test'}/app` },
    organization: SAMPLE_ORGANIZATION,
    reason: 'You get this email because you made this request. An administrator can change these emails in Settings › Notifications.',
  };
}
