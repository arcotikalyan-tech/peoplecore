# Runbook · Security incident response

Use this for a suspected breach, a leaked key, unexpected access to someone's data, or abuse of a public page.
For a plain outage, see [operations.md](operations.md). The privacy notes in [07-threat-model.md](../07-threat-model.md) apply.

**Roles:** the incident lead owns the response and the timeline. One person handles communications. Whoever
has Supabase and Vercel access does the containment steps.

## 1. Detect and open the incident (first 15 minutes)

Sources:
- Alerts on spikes in refused requests (`42501`), sign-in failures, exports and AI use. The owner's AI page shows the month's runs per assistant.
- The audit log (`audit_events`).
- Customer reports.

Then:
1. Write down what was seen, when, and by whom.
2. Open an incident note with a running timeline (UTC and IST).
3. Classify it:
   - **SEV1:** personal data exposed outside its tenant, the secret key leaked, or payroll or bank data tampered with.
   - **SEV2:** exposure inside a tenant beyond someone's permissions, or a public page being abused.
   - **SEV3:** a suspicion with no evidence yet.

## 2. Contain

| Situation | Action |
|---|---|
| `SUPABASE_SECRET_KEY` leaked | Supabase dashboard → Project Settings → API Keys: create a new secret key, deploy it to the web app and the worker, then **delete the old key**. Every server-side call fails until the new key is deployed, so do both in one sitting. |
| AI provider key leaked | Revoke it in the provider console and set the new one (`ANTHROPIC_API_KEY`). To stop all AI at once, unset the key: the assistants fail closed. |
| A user account is compromised | Platform console or Supabase Auth: sign the user out everywhere, reset the password, and remove their authenticator so they have to set it up again. Suspend their membership in each organization (Members page). |
| A role grants too much | The owner removes the role (Members). Every grant change is in the audit log. |
| A tenant must be frozen | Platform console → suspend the organization. Its members can't sign in to it; the data is untouched. |
| Public careers page abused | Unpublish the affected requisitions. Then add an edge rate limit or block in Vercel. |
| Payroll or bank file tampering suspected | Do not lock or pay the run. Cancel it (draft or computed), then compare the inputs fingerprint (`inputs_hash`) with a recomputation. Locked runs are immutable, and corrections go through arrears. |

## 3. Assess

- Use the audit log to see who read or changed what. Sensitive reads are recorded too: identity numbers shown, document downloads, grievance case views and exports.
- Check the Supabase logs (API, Auth, Postgres) for the time window.
- Decide which organizations, people and data classes are affected. Identity, bank, salary, medical and grievance data count as sensitive.
- Keep the evidence: export the relevant audit rows and logs before they age out.

## 4. Notify

- Customers (organization owners) whose data was affected: what happened, what data, what we did, and what they should do. Follow the contract's timeline.
- Data Protection Board of India and affected people, as the DPDP Act 2023 and its Rules require for a personal data breach. **Check the current rules and deadlines with counsel; don't rely on this runbook for the legal obligation.**
- Keep a breach record even when notification isn't required.

## 5. Recover and learn

- Fix the cause. If it was a policy or grant mistake, add a database test that would have caught it, next to the existing RLS and privileges tests.
- Within 5 working days, write a post-mortem: the timeline, the root cause, what went well, and the action items with owners.
- Update the threat model if the incident showed a new threat or a missing mitigation.
