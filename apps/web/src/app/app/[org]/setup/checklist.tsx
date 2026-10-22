import Link from 'next/link';
import { cn } from '@/components/ui/cn';
import { Badge } from '@/components/ui/surface';
import { SETUP_GROUPS, type SetupProgress, type SetupStep } from '@/lib/org-setup';
import { markSetupAction } from './actions';
import { MarkStep } from './setup-client';

/** Organization setup: the progress bar, the dashboard card and the full checklist. */

export function SetupProgressBar({ progress }: { progress: SetupProgress }) {
  return (
    <div className="h-2.5 rounded-full bg-subtle" role="progressbar" aria-label="Setup progress" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2.5 rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
    </div>
  );
}

const left = (p: SetupProgress) => (p.requiredLeft ? `${p.requiredLeft} required step${p.requiredLeft === 1 ? '' : 's'} left` : 'only optional steps left');

/** On the dashboard of the people who run setup, until everything is done: the percentage and the next steps. */
export function SetupCard({ slug, orgName, progress }: { slug: string; orgName: string; progress: SetupProgress }) {
  const app = `/app/${slug}`;
  return (
    <section aria-label="Organization setup" className="rounded-2xl border border-primary/25 bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Organization setup</p>
          <h2 className="mt-1 text-lg font-semibold">{progress.done === 0 ? `Let’s set up ${orgName}` : `Finish setting up ${orgName}`}</h2>
          <p className="mt-0.5 text-sm text-muted">{progress.done} of {progress.total} steps done · {left(progress)}</p>
        </div>
        <p className="text-3xl font-bold tabular-nums text-primary">{progress.percent}%<span className="text-sm font-medium text-muted"> done</span></p>
      </div>
      <div className="mt-3"><SetupProgressBar progress={progress} /></div>
      <ol className="mt-4 space-y-2" aria-label="Next setup steps">
        {progress.next.slice(0, 3).map((s) => (
          <li key={s.key} className="flex items-start justify-between gap-3 rounded-lg bg-subtle px-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{s.title}</span>{s.required && <span className="ml-2 text-xs font-medium text-primary">Required</span>}
              <span className="block text-xs text-muted">{s.what}</span>
            </span>
            <Link className="shrink-0 font-medium text-primary hover:underline" href={`${app}/${s.href}`} aria-label={`Start: ${s.title}`}>Start →</Link>
          </li>
        ))}
      </ol>
      <Link href={`${app}/setup`} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">See all {progress.total} steps →</Link>
    </section>
  );
}

/** The progress summary and every step, grouped and numbered in the order that works best. */
export function SetupChecklist({ slug, orgName, progress }: { slug: string; orgName: string; progress: SetupProgress }) {
  const number = new Map(progress.steps.map((s, i) => [s.key, i + 1]));
  return (
    <div className="space-y-5">
      <section aria-label="Progress" className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted">{progress.done} of {progress.total} steps done · {left(progress)}</p>
          <p className="text-3xl font-bold tabular-nums text-primary">{progress.percent}%<span className="text-sm font-medium text-muted"> done</span></p>
        </div>
        <div className="mt-2"><SetupProgressBar progress={progress} /></div>
        <p className="mt-3 text-sm">{progress.percent === 100
          ? <span className="text-success">🎉 {orgName} is set up. You can change any of this later; each step still opens its page.</span>
          : <span className="text-muted">Each step opens the page where you do it, and ticks itself once your details are in. Steps that start with sensible defaults ask you to confirm them.</span>}</p>
      </section>
      {SETUP_GROUPS.map((group) => {
        const steps = progress.steps.filter((s) => s.group === group);
        if (steps.length === 0) return null;
        return (
          <section key={group} aria-label={group} className="rounded-xl border border-line bg-surface">
            <h2 className="px-5 pb-1 pt-4 text-sm font-semibold">{group}</h2>
            <ol className="divide-y divide-line">
              {steps.map((s) => <StepRow key={s.key} n={number.get(s.key) ?? 0} s={s} slug={slug} />)}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function StepRow({ n, s, slug }: { n: number; s: SetupStep; slug: string }) {
  const action = markSetupAction.bind(null, slug);
  const done = s.status === 'done';
  const skipped = s.status === 'skipped';
  const note = [s.detail, done ? (s.byData ? 'Done: your details are in' : 'Done: confirmed') : null, skipped ? 'Not needed' : null].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-3.5 text-sm" aria-label={`${s.title}: ${done ? 'done' : skipped ? 'not needed' : 'to do'}`}>
      <span aria-hidden="true" className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold',
        done ? 'bg-success-soft text-success' : skipped ? 'bg-subtle text-muted' : 'bg-primary-soft text-primary')}>{done ? '✓' : skipped ? '–' : n}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className={cn('font-medium', skipped && 'text-muted')}>{s.title}</span>
          {s.required ? <Badge tone="primary">Required</Badge> : <Badge>Optional</Badge>}
        </p>
        <p className="mt-0.5 text-muted">{s.what}</p>
        {note && <p className={cn('mt-1 text-xs', done ? 'text-success' : 'text-muted')}>{note}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link className="font-medium text-primary hover:underline" href={`/app/${slug}/${s.href}`} aria-label={`${done || skipped ? 'Review' : 'Start'}: ${s.title}`}>
          {done || skipped ? 'Review' : 'Start'} →
        </Link>
        {s.status === 'todo' && s.check === 'confirm' && <MarkStep action={action} step={s.key} mark="done" label="Looks right" aria={`Looks right: ${s.title}`} variant="secondary" />}
        {s.status === 'todo' && !s.required && <MarkStep action={action} step={s.key} mark="skipped" label="Not needed" aria={`Not needed: ${s.title}`} />}
        {(skipped || (done && !s.byData)) && <MarkStep action={action} step={s.key} mark="clear" label="Undo" aria={`Undo: ${s.title}`} />}
      </div>
    </li>
  );
}
