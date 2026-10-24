import type { Metadata } from 'next';
import { todayIn } from '@peoplecore/shared';
import { ActionForm } from '@/components/action-form';
import { FormattedText } from '@/components/formatted-text';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { getOrgContext } from '@/server/context';
import { acknowledgementCounts, colleagueOptions, kudosFeed, listAnnouncements } from '@/server/engagement';
import { signAnnouncementImages } from '@/server/document-storage';
import { getMyEmployee } from '@/server/employees';
import { getStructure, structureOptions } from '@/server/structure';
import { acknowledgeAnnouncementAction, deleteAnnouncementAction, giveKudosAction, publishAnnouncementAction } from './actions';
import { KudosForm, PublishAnnouncementForm } from './engagement-forms';
import { requireModule } from '@/server/modules';

export const metadata: Metadata = { title: 'Engagement' };

export default async function EngagementPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  await requireModule(ctx.org.id, 'engagement');
  const me = await getMyEmployee(ctx.org.id, ctx.user.id);
  const manages = ctx.can('announcement.manage', 'org');
  const [announcements, kudos, colleagues, structure] = await Promise.all([
    listAnnouncements(ctx.org.id, me?.id ?? null),
    kudosFeed(ctx.org.id),
    me ? colleagueOptions(ctx.org.id, me.id) : Promise.resolve([]),
    manages ? getStructure(ctx.org.id) : Promise.resolve(null),
  ]);
  const acks = manages ? await acknowledgementCounts(ctx.org.id, announcements.filter((a) => a.requires_ack).map((a) => a.id)) : new Map<string, number>();
  const options = structure ? structureOptions(structure) : null;
  const pictures = await signAnnouncementImages(announcements.map((a) => a.image_path));
  const audience = (a: (typeof announcements)[number]) =>
    [a.department_id && structure?.departments.find((d) => d.id === a.department_id)?.name,
     a.location_id && structure?.locations.find((l) => l.id === a.location_id)?.name].filter(Boolean).join(' · ') || 'Everyone';
  const now = new Date().toISOString();

  return (
    <>
      <PageHeader title="Engagement" description="Company announcements and kudos from colleagues." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="space-y-6" aria-label="Announcements">
          {announcements.length === 0 && <Card><p className="px-5 py-4 text-sm text-muted">No announcements right now.</p></Card>}
          {announcements.map((a) => {
            const live = a.published_at <= now && (!a.expires_at || a.expires_at > now);
            return (
              <section key={a.id} aria-label={a.title}>
                <Card>
                  <CardHeader title={a.title}
                    description={`${formatDate(a.published_at)}${a.expires_at ? ` · until ${formatDate(new Date(Date.parse(a.expires_at) - 1).toISOString())}` : ''}${manages ? ` · ${audience(a)}` : ''}`}
                    actions={a.acknowledgedAt ? <Badge tone="success">Acknowledged</Badge> : manages && !live ? <Badge>Not showing</Badge> : undefined} />
                  {a.image_path && pictures.get(a.image_path) && (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset
                    <img src={pictures.get(a.image_path)} alt="" className="max-h-80 w-full border-b border-line object-cover" />
                  )}
                  <FormattedText text={a.body} className="px-5 py-4 text-sm leading-6" />
                  {(a.requires_ack && me && !a.acknowledgedAt && live) || manages ? (
                    <div className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-3 text-sm">
                      {a.requires_ack && me && !a.acknowledgedAt && live && (
                        <ActionForm action={acknowledgeAnnouncementAction.bind(null, slug)} label={`Acknowledge ${a.title}`} submit="I have read this"
                          hidden={{ announcementId: a.id }} size="sm" className="flex flex-wrap items-center gap-3" />
                      )}
                      {manages && a.requires_ack && <span className="text-muted">{acks.get(a.id) ?? 0} acknowledged</span>}
                      {manages && (
                        <ActionForm action={deleteAnnouncementAction.bind(null, slug)} label={`Remove ${a.title}`} submit="Remove"
                          hidden={{ announcementId: a.id }} variant="ghost" size="sm" className="ml-auto inline-flex items-center gap-2" />
                      )}
                    </div>
                  ) : null}
                </Card>
              </section>
            );
          })}
        </section>
        <div className="space-y-6">
          {manages && options && (
            <Card>
              <CardHeader title="Publish an announcement" />
              <PublishAnnouncementForm action={publishAnnouncementAction.bind(null, slug)} departments={options.departments} locations={options.locations} today={todayIn(ctx.org.timezone)} />
            </Card>
          )}
          {me && <Card><CardHeader title="Give kudos" description="Everyone in the organization can see kudos." /><KudosForm action={giveKudosAction.bind(null, slug)} colleagues={colleagues} /></Card>}
          <Card>
            <CardHeader title="Kudos" />
            {kudos.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No kudos yet. Be the first.</p> : (
              <ul className="divide-y divide-line" aria-label="Kudos">
                {kudos.map((k) => (
                  <li key={k.id} className="px-5 py-3 text-sm">
                    <p><span className="font-medium">{k.from_name}</span> <span className="text-muted">to</span> <span className="font-medium">{k.to_name}</span></p>
                    <p className="mt-1">{k.message}</p>
                    <p className="mt-1 text-xs text-muted">{formatDate(k.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
