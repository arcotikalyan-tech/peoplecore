# Runbook · Email

Every email PeopleCore sends uses one layout (brand name, logo, accent colour, footer, support address), the same for
every organization. Platform administrators set it in **Platform › Email templates** (`/platform/emails`), where they
also reword the account emails, preview them live (desktop and phone width) and send themselves a test. Stored in
`platform_email_layout` and `platform_email_templates` (migration 20261031220000); defaults and rendering in
`packages/shared/src/email.ts`.

| Email | Sent when | Sent by | Words |
|---|---|---|---|
| Invitation | HR, an owner or a platform admin gives someone a sign-in | Supabase Auth → the app's send-email hook | Editable (`{{organization}}`, `{{inviter}}`, `{{email}}`, `{{brand}}`) |
| Password reset | "Forgot password?" (website or phone), or a password setup link from Users & roles | same | Editable |
| Sign-in link | "Sign in with an email link" | same | Editable |
| Email address change, confirmation code | Supabase asks for them (not used by the app today) | same | Editable |
| Notifications (approvals, decisions, payslips, helpdesk, birthdays, sign-up alerts…) | Settings › Notifications, per organization | The worker, from `email_outbox`, every 15 minutes | Written by the app; wrapped in the layout |

Account emails go out straight away: Supabase Auth doesn't send them itself but posts each one, signed, to
`/api/auth/send-email` (its **send-email hook**), and the app sends it over SMTP. The invitation link goes to
`/auth/callback?token_hash=…&type=invite` (the server can't read the session Supabase's own link puts in the URL
fragment); the others use Supabase's verify link, exactly as its built-in templates did.

## Local and CI

`supabase start` captures every email in the Mailpit test inbox (http://127.0.0.1:54324), and the browser tests read it
(`e2e/email.spec.ts`, `e2e/email-templates.spec.ts`, `e2e/account.spec.ts`). `supabase/config.toml` turns the hook on
(`[auth.hook.send_email]` → `http://host.docker.internal:3000/api/auth/send-email`, with a secret for the local stack
only) and opens Mailpit's SMTP port 54325. So the web app must run on port 3000, with these in `apps/web/.env.local`:

```
SMTP_URL=smtp://127.0.0.1:54325
EMAIL_FROM="PeopleCore <no-reply@peoplecore.example.test>"
SEND_EMAIL_HOOK_SECRET=<the secrets value from [auth.hook.send_email] in supabase/config.toml>
```

CI writes the same. After changing `config.toml`, restart the stack (`supabase stop && supabase start`; the database is
kept). Without the dev server on :3000, invitations and reset links fail with "Error sending … email".

## Live

Use the **Peoplecore** Supabase project (`rncjncpazqxqkfqoumsk`) only, never the Vibe Upp one. Type passwords and
secrets into the server's `.env` or the Supabase dashboard only, never into chat, a file in the repo or a commit.

### 1. Mailbox and DNS

In Hostinger hPanel → Emails, create (or choose) a mailbox on your domain, e.g. `no-reply@yourdomain`, and check that
SPF, DKIM and DMARC are set (hPanel can add them when the domain's DNS is at Hostinger). Without them, mail lands in
spam.

### 2. The app server's settings (`/opt/peoplecore/.env`, shared by the web app and the worker)

| Variable | Value |
|---|---|
| `SMTP_URL` | `smtps://no-reply%40yourdomain:PASSWORD@smtp.hostinger.com:465` (URL-encode `@` in the user as `%40`) |
| `EMAIL_FROM` | `PeopleCore <no-reply@yourdomain>` (the sender's name follows the layout's brand name) |
| `APP_URL` | The app's address, e.g. `https://hrms.yourdomain`, for links and the logo |
| `SEND_EMAIL_HOOK_SECRET` | The secret Supabase generates in step 3 (`v1,whsec_…`) |

Then `docker compose up -d web worker`. Without `SMTP_URL`, notification emails wait in the outbox and expire after two
days, and the console says email isn't set up.

### 3. Supabase: hand account emails to the app

Authentication → **Hooks** → Add hook → **Send Email hook** → type **HTTPS**:

- URL: `https://<the app's address>/api/auth/send-email`
- Generate a secret, put it in `SEND_EMAIL_HOOK_SECRET` (step 2) and restart the web app **before** enabling the hook.
- Enable it.

From then on Supabase's own email templates and SMTP settings are not used. To go back to them (for example if the app
is down for long), disable the hook: Supabase then sends with its own templates over the SMTP set in Authentication →
Emails → SMTP Settings (keep those filled in as a fallback: host `smtp.hostinger.com`, port 465, the mailbox and its
password, sender name `PeopleCore`).

Also keep Authentication → URL Configuration right: Site URL is the app's address, and Redirect URLs include
`https://<app>/auth/callback` and `https://<app>/auth/callback?**`.

### 4. Check it

As a platform admin, open Platform › Email templates: "How emails go out" should show the mail server and the hook key
as set. Use **Send me a test** on the Invitation. Then invite an address you can read from Users & roles, and use
"Forgot password?" with it; both should arrive within a minute in the new layout. Remove the test member afterwards.

If an account email doesn't arrive: Supabase dashboard → Logs → Auth shows the hook's answer (401: the secret differs
between Supabase and the server; 500 "isn't set up": `SEND_EMAIL_HOOK_SECRET` or `SMTP_URL` missing; 502: the mail
server refused it, and the web app's log has `email.auth_failed` with the reason). Notification emails: Settings ›
Notifications › Recent emails shows each one's status (waiting, sent, failed after five attempts, or expired).
