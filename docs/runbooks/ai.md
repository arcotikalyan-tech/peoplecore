# Runbook · AI assistants

PeopleCore's assistants (Ask HR first; document reading, drafting and the reporting copilot follow) run through
`packages/ai` (ADR-009, [06-ai-architecture.md](../06-ai-architecture.md)). Everything they produce is a suggestion
shown in an AI container. Records are only written when a person submits the module's normal form.

## Turning it on

AI needs two switches, and both must be on:

1. **The server has a model provider.** Without one, every assistant says "AI isn't set up on this server yet". Set
   these in the web app's environment (Vercel project settings, or `apps/web/.env.local` locally). They are server
   only; never prefix them with `NEXT_PUBLIC_`.

   | Variable | Default | Notes |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | none | Required. Read only in `apps/web/src/server/ai.ts`. |
   | `AI_MODEL` | `claude-opus-5-5` | Answers and drafts. |
   | `AI_FAST_MODEL` | `claude-haiku-5-5` | Reading documents (resumes, receipts). |
   | `AI_FALLBACK_MODEL` | `claude-sonnet-5-5` | Tried once when the main model keeps failing. |
   | `ANTHROPIC_BASE_URL` | Anthropic's API | Only for a gateway. |

2. **The organization turns assistants on.** The owner opens **AI assistants** in the sidebar, ticks "Turn on AI
   assistants", and sets a monthly token budget and an hourly limit per person. The same page shows the month's
   use by assistant, including how many answers people marked helpful or not.

Before turning it on for a real customer, agree a **no-training, zero-data-retention** arrangement with the provider.
Then record it in the customer's data-processing terms.

## What is sent, what is kept

- The question, with email addresses, phone numbers, PAN, Aadhaar, IFSC and bank account numbers masked.
- The passages the search found. The search runs as the person asking, so it only returns what they could open
  themselves: published knowledge-base articles and current policies, and never drafts.
- `ai_runs` keeps the model, prompt version, token counts, latency and what was masked, for every run. It also
  keeps the redacted prompt and the output, but only the service role can read those, and the worker clears them
  after 30 days (`ai.retention`, daily).
- Uploaded files (from the document-reading assistants) go to the model and are not stored with the run; only
  their type and size are.

## Limits and failures

- **The gate refuses** in four cases: AI is off for the organization, the person's role lacks `ai.use` (or the
  assistant's module permission), they reached the hourly limit, or the organization used its monthly budget. Each
  refusal shows the person a clear message, and no model call is made.
- **Provider errors** (rate limits, overload, server errors) are retried twice with backoff, then the fallback model
  is tried. If that fails too, the person sees "The assistant couldn't answer just now" and the run is recorded
  as failed.
- **Runs left open** by a crash are closed as failed after an hour by the worker.

## Development and browser tests

Set `AI_PROVIDER=mock` to run the assistants without a model. It gives fixed answers built from the retrieved
sources: Ask HR quotes the best passage and cites it. It is refused when `NODE_ENV=production`. The browser test
`e2e/ai.spec.ts` needs the dev server started with it:

```sh
AI_PROVIDER=mock corepack pnpm --filter @peoplecore/web dev
```

## Evals

- `packages/ai/evals/<agent>/*.jsonl` holds one case per line: input, fixture data, the recorded model answer, and
  expectations (cites the right source, says "not found" when nothing matches, masks identifiers, ignores
  instructions planted in a source).
- The cases replay through the real pipeline in `corepack pnpm check`.
- Against the live model:

  ```sh
  ANTHROPIC_API_KEY=… corepack pnpm --filter @peoplecore/ai eval:live            # all agents
  ANTHROPIC_API_KEY=… AI_EVAL_THRESHOLD=0.95 corepack pnpm --filter @peoplecore/ai eval:live policy_assistant
  ```

  The run exits non-zero when an agent scores below the threshold (default 90%). Cases marked `recordedOnly` are
  skipped, because they test the pipeline's own handling of malformed answers. Run this nightly, and before
  changing a prompt or the model.
