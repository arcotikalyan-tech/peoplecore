import { NextResponse, type NextRequest } from 'next/server';
import { getOrgContext } from '@/server/context';
import { getMyEmployee } from '@/server/employees';
import { cardSvgs, zipFiles } from '@/server/idcard-svg';
import { cardCompany, cardDesigns, cardPeople, cardQr } from '@/server/idcards';
import { disabledModules } from '@/server/modules';

/** Logos up to this size are embedded in every card; a bigger one is added once as a file the cards link to. */
const EMBED_LOGO_BYTES = 48 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safe = (s: string) => s.replace(/[^\p{L}\p{N} ._-]+/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'card';

/**
 * "Export all": every card of a design as print-ready SVG (front and back) in one ZIP. HR exports everyone or a
 * department; anyone else gets only their own card (as on the print page). RLS decides which people come back.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if ((await disabledModules(ctx.org.id)).has('idstudio')) return new NextResponse('Not found', { status: 404 });
  const sp = request.nextUrl.searchParams;
  const designs = await cardDesigns(ctx.org.id);
  const wanted = sp.get('design');
  const design = designs.find((d) => d.id === wanted) ?? designs.find((d) => d.is_default && d.card_type === 'id') ?? designs[0];
  if (!design) return new NextResponse('There is no card design yet.', { status: 404 });
  const hr = ctx.can('org.manage', 'org') && ctx.can('employee.read', 'org');
  const employee = sp.get('employee') ?? '';
  const department = sp.get('department') ?? '';
  const me = hr ? null : await getMyEmployee(ctx.org.id, ctx.user.id);
  const people = hr
    ? await cardPeople(ctx.org.id, UUID.test(employee) ? { ids: [employee] } : UUID.test(department) ? { departmentId: department } : {})
    : me ? await cardPeople(ctx.org.id, { ids: [me.id] }) : [];
  if (!people.length) return new NextResponse('No one to export.', { status: 404 });

  const company = await cardCompany(ctx.org.id, ctx.org.name, design);
  const files: Array<{ name: string; data: Uint8Array }> = [];
  let logo: string | null = null;
  if (company.logoUrl) {
    const res = await fetch(company.logoUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (res?.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
      if (bytes.length <= EMBED_LOGO_BYTES) logo = `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
      else {
        logo = type === 'image/png' ? 'logo.png' : 'logo.jpg';
        files.push({ name: logo, data: bytes });
      }
    }
  }
  const enc = new TextEncoder();
  for (const p of people) {
    // The photo goes inside the file (a data: URI), so saved and printed cards keep it after the link expires.
    let photo: string | null = null;
    if (design.show_photo && p.photo) {
      const res = await fetch(p.photo, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (res?.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        photo = `data:${bytes[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}`;
      }
    }
    const { front, back } = cardSvgs({ design, person: { ...p, photo }, company: company.name, website: company.website, logo, qrSvg: await cardQr(design, p, company.name) });
    const base = safe(`${p.code} ${p.name}`);
    files.push({ name: `${base} - front.svg`, data: enc.encode(front) }, { name: `${base} - back.svg`, data: enc.encode(back) });
  }
  const zip = zipFiles(files);
  // Header values must be ASCII; names inside the ZIP keep their letters (UTF-8 flag).
  const name = `${design.card_type === 'visiting' ? 'visiting-cards' : 'id-cards'}-${slug}-${design.name}`.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100);
  return new NextResponse(Buffer.from(zip), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}.zip"`, 'Cache-Control': 'no-store' },
  });
}
