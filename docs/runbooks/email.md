# Runbook · Email for sign-in links and invitations

PeopleCore sends two kinds of email, both through Supabase Auth:

| Email | Sent when | Link goes to |
|---|---|---|
| Sign-in link (magic link) | Someone chooses "Sign in with an email link" | Supabase verifies it, then `/auth/callback?code=…` |
| Invitation | HR or the platform admin invites a person with no PeopleCore sign-in | `/auth/callback?token_hash=…&type=invite` (custom template below) |

Supabase's built-in sender is for testing only: a few emails per hour, and it may only deliver to members of
the Supabase organization. Real users need custom SMTP.

## Local and CI

Nothing to configure. `supabase start` captures every email in the Mailpit test inbox
(http://127.0.0.1:54324), and the browser tests in `apps/web/e2e/email.spec.ts` read it. The invitation
template and limits come from `supabase/config.toml`.

## Live project: Hostinger email SMTP

Do these in the Supabase dashboard for the **Peoplecore** project (`rncjncpazqxqkfqoumsk`). Never in the
Vibe Upp project. Type the mailbox password into the dashboard only, never into chat, a file or a commit.

1. **Mailbox.** In Hostinger hPanel → Emails, create (or choose) a mailbox on your domain, e.g.
   `no-reply@yourdomain`. In hPanel → Emails → your domain → DNS / Connect devices, check that SPF, DKIM and
   DMARC records are set (hPanel can add them automatically when the domain's DNS is at Hostinger). Without
   them, mail lands in spam.
2. **SMTP.** Authentication → Emails → SMTP Settings → enable custom SMTP:

   | Field | Value |
   |---|---|
   | Sender email | the mailbox address, e.g. `no-reply@yourdomain` |
   | Sender name | `PeopleCore` |
   | Host | `smtp.hostinger.com` |
   | Port | `465` (SSL) |
   | Username | the full mailbox address |
   | Password | the mailbox password |
   | Minimum interval between emails | keep the default |

3. **Rate limit.** Authentication → Rate Limits → "Emails sent per hour": raise to what you expect (e.g. 100).
   Hostinger's own sending limits apply too.
4. **URLs.** Authentication → URL Configuration:
   - Site URL: where the app runs. Today that's `http://localhost:3000`; change it when the app is deployed.
   - Redirect URLs: `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/callback?**`, plus the
     same two for the deployed address later.
5. **Invitation template.** Authentication → Emails → Templates → "Invite user":
   - Subject: `You’ve been invited to PeopleCore`
   - Body: paste the contents of [`supabase/templates/invite.html`](../../supabase/templates/invite.html).
   The default template puts the session in a URL fragment, which the server can't read, so invitations
   would fail without this.
6. **Test with a real mailbox.** Sign in as the demo HR account, open Members, and invite an address you can
   read (not `example.test`). The invitation should arrive within a minute; opening it should land the new
   person in the organization. Then, on the login page, use "Sign in with an email link instead" with that
   address. Afterwards remove the test member from the Members page.

If an email doesn't arrive: Supabase dashboard → Logs → Auth shows the SMTP error (wrong password, port
blocked, or the sender address not matching the mailbox are the usual causes).

## Notification emails from the worker (2026-10-22)

Email notifications chosen in Settings › Notifications (regularization, leave and expense applications, birthdays,
work anniversaries, by role) are queued in `email_outbox` and sent by the worker's `notifications.email` job every
15 minutes. They use the same Hostinger mailbox, configured for the worker in `/opt/peoplecore/.env` (shared with
the web app). Type the password into that file on the server only, never into chat, a file in the repo or a commit.

| Variable | Value |
|---|---|
| `SMTP_URL` | `smtps://no-reply%40yourdomain:PASSWORD@smtp.hostinger.com:465` (URL-encode `@` in the user as `%40`) |
| `EMAIL_FROM` | `PeopleCore <no-reply@yourdomain>` |
| `APP_URL` | The app's address, e.g. `https://hr.yourdomain`, for the links in emails |

Then restart the worker (`docker compose up -d worker`). Without `SMTP_URL`, emails wait in the outbox and expire
after two days, so nothing piles up. Settings › Notifications › Recent emails shows each email's status (waiting,
sent, failed after five attempts, or expired). Locally, point `SMTP_URL` at Mailpit (`smtp://127.0.0.1:54325` when
`[inbucket] smtp_port` is set in `supabase/config.toml`).
