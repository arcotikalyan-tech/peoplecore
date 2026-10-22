import { CARD_FIELDS, cardValue, templateFor, type CardDesign, type CardPerson } from '@/lib/id-cards';
import { formatDate } from '@/lib/format';

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/**
 * One ID card, front and back, at CR80 proportions (54 × 86 mm). Inline styles carry the design's colours so the
 * card prints exactly as previewed in either theme.
 */
export function IdCard({ design, person, company, logoUrl, qrSvg, back = true, website = null }: {
  design: CardDesign; person: CardPerson; company: string; logoUrl: string | null; qrSvg: string | null; back?: boolean; website?: string | null;
}) {
  if (design.card_type === 'visiting') return <VisitingCard design={design} person={person} company={company} logoUrl={logoUrl} qrSvg={qrSvg} back={back} website={website} />;
  const t = templateFor(design.template);
  const land = design.orientation === 'landscape';
  const size = land ? { width: '86mm', height: '54mm' } : { width: '54mm', height: '86mm' };
  const base = { ...size, color: design.text_color, background: t.tint ? `${design.primary_color}14` : '#ffffff', fontFamily: 'inherit' };
  const rows: Array<[string, string]> = [
    ...CARD_FIELDS.filter(([k]) => design.fields.includes(k) && k !== 'designation').flatMap(([k, label]): Array<[string, string]> => {
      const v = k === 'date_of_joining' ? formatDate(person.date_of_joining) : cardValue(k, person, website);
      return v ? [[label, v]] : [];
    }),
    ...design.custom_fields.map((c): [string, string] => [c.label, c.value]),
  ];
  const photo = design.show_photo && (
    <div aria-hidden style={{ background: design.accent_color, color: '#fff', borderRadius: t.photo === 'circle' ? '9999px' : t.photo === 'rounded' ? '10px' : '2px',
      width: land ? '18mm' : '20mm', height: land ? '18mm' : '20mm', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '16px', flexShrink: 0,
      border: `2px solid ${design.primary_color}` }}>{initials(person.name)}</div>
  );
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: t.align === 'center' ? 'center' : 'flex-start',
      color: t.header === 'none' ? design.primary_color : '#fff', fontWeight: 700, fontSize: '10px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, printed at card size */}
      {logoUrl && <img src={logoUrl} alt="" style={{ height: '16px', maxWidth: '24mm', objectFit: 'contain', background: '#fff', borderRadius: '3px', padding: '1px' }} />}
      <span>{company}</span>
    </div>
  );
  const bg = t.header === 'full' ? design.primary_color : t.header === 'wave' ? `linear-gradient(160deg, ${design.primary_color}, ${design.accent_color})` : design.primary_color;
  const front = (
    <section aria-label={`ID card for ${person.name}`} className="idcard" style={{ ...base, position: 'relative', overflow: 'hidden', borderRadius: '3mm', boxShadow: '0 1px 3px rgba(0,0,0,.15)', border: '1px solid #e5e7eb', display: 'flex', flexDirection: t.header === 'side' ? 'row' : 'column' }}>
      {t.header === 'side' && <div style={{ width: '6mm', background: design.primary_color }} />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '3mm', background: t.header === 'band' || t.header === 'full' || t.header === 'wave' ? bg : 'transparent',
          minHeight: t.header === 'full' ? (land ? '18mm' : '30mm') : undefined, borderBottomLeftRadius: t.header === 'wave' ? '50% 18%' : undefined, borderBottomRightRadius: t.header === 'wave' ? '50% 18%' : undefined }}>
          {header}
        </div>
        <div style={{ padding: '2.5mm 3mm', display: 'flex', flexDirection: land ? 'row' : 'column', alignItems: t.align === 'center' && !land ? 'center' : 'flex-start', gap: '2.5mm', flex: 1,
          marginTop: t.header === 'full' && !land ? '-14mm' : undefined, textAlign: t.align === 'center' && !land ? 'center' : 'left' }}>
          {photo}
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontWeight: 700, fontSize: '12px', lineHeight: 1.2 }}>{person.name}</p>
            {design.fields.includes('designation') && person.designation && <p style={{ color: design.primary_color, fontSize: '9px', fontWeight: 600, marginTop: '1px' }}>{person.designation}</p>}
            <dl style={{ marginTop: '2mm', fontSize: '8px', lineHeight: 1.45 }}>
              {rows.map(([k, v]) => <div key={k} style={{ display: 'flex', gap: '4px', justifyContent: t.align === 'center' && !land ? 'center' : 'flex-start' }}><dt style={{ opacity: 0.65 }}>{k}</dt><dd style={{ fontWeight: 600 }}>{v}</dd></div>)}
            </dl>
          </div>
        </div>
        {qrSvg && !back && <div aria-hidden style={{ position: 'absolute', right: '3mm', bottom: '3mm', width: '12mm', height: '12mm' }} dangerouslySetInnerHTML={{ __html: qrSvg }} />}
        <div style={{ height: '2mm', background: design.accent_color }} />
      </div>
    </section>
  );
  if (!back) return front;
  return (
    <div className="flex flex-wrap gap-4">
      {front}
      <section aria-label={`Back of ID card for ${person.name}`} className="idcard" style={{ ...base, borderRadius: '3mm', boxShadow: '0 1px 3px rgba(0,0,0,.15)', border: '1px solid #e5e7eb', padding: '4mm', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center', fontSize: '8px' }}>
        <p style={{ fontWeight: 700, color: design.primary_color, fontSize: '10px' }}>{company}</p>
        {qrSvg && <div aria-label="QR code" role="img" style={{ width: land ? '22mm' : '28mm', height: land ? '22mm' : '28mm' }} dangerouslySetInnerHTML={{ __html: qrSvg }} />}
        <p style={{ whiteSpace: 'pre-line', opacity: 0.8 }}>{design.back_text ?? 'If found, please return to the company.'}</p>
        <div style={{ height: '1.5mm', width: '100%', background: design.primary_color, borderRadius: '2px' }} />
      </section>
    </div>
  );
}

/** A visiting card, front and back, at business-card size (89 × 51 mm). */
export function VisitingCard({ design, person, company, logoUrl, qrSvg, back = true, website = null }: {
  design: CardDesign; person: CardPerson; company: string; logoUrl: string | null; qrSvg: string | null; back?: boolean; website?: string | null;
}) {
  const t = templateFor(design.template);
  const size = { width: '89mm', height: '51mm' };
  const lines = [
    ...(['phone', 'work_email', 'office_address', 'website', 'location', 'department'] as const).filter((k) => design.fields.includes(k))
      .map((k) => cardValue(k, person, website)).filter((v): v is string => !!v),
    ...design.custom_fields.map((c) => `${c.label}: ${c.value}`),
  ];
  const band = t.header === 'none' ? null : t.header === 'wave' ? `linear-gradient(160deg, ${design.primary_color}, ${design.accent_color})` : design.primary_color;
  const front = (
    <section aria-label={`Visiting card for ${person.name}`} className="idcard" style={{ ...size, position: 'relative', overflow: 'hidden', borderRadius: '2mm', boxShadow: '0 1px 3px rgba(0,0,0,.15)',
      border: '1px solid #e5e7eb', background: t.tint ? `${design.primary_color}10` : '#ffffff', color: design.text_color, display: 'flex' }}>
      {band && <div style={{ width: t.header === 'side' ? '4mm' : '24mm', background: band, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2mm' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, printed at card size */}
        {t.header !== 'side' && logoUrl && <img src={logoUrl} alt="" style={{ maxWidth: '18mm', maxHeight: '14mm', objectFit: 'contain', background: '#fff', borderRadius: '2px', padding: '1px' }} />}
      </div>}
      <div style={{ flex: 1, padding: '4mm 4mm 3mm', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', textAlign: t.align === 'center' ? 'center' : 'left' }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: '13px', lineHeight: 1.2 }}>{person.name}</p>
          {design.fields.includes('designation') && person.designation && <p style={{ color: design.primary_color, fontSize: '9px', fontWeight: 600, marginTop: '1px' }}>{person.designation}</p>}
          <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.7, marginTop: '1.5mm' }}>{company}</p>
        </div>
        <ul style={{ fontSize: '7.5px', lineHeight: 1.5, listStyle: 'none', padding: 0, margin: 0 }}>
          {lines.map((l) => <li key={l} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l}</li>)}
        </ul>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '1.2mm', background: design.accent_color }} />
    </section>
  );
  if (!back) return front;
  return (
    <div className="flex flex-wrap gap-4">
      {front}
      <section aria-label={`Back of visiting card for ${person.name}`} className="idcard" style={{ ...size, borderRadius: '2mm', boxShadow: '0 1px 3px rgba(0,0,0,.15)', border: '1px solid #e5e7eb',
        background: band ?? design.primary_color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4mm', padding: '5mm' }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: '13px' }}>{company}</p>
          {website && <p style={{ fontSize: '8px', opacity: 0.85, marginTop: '1mm' }}>{website}</p>}
          {design.back_text && <p style={{ fontSize: '7.5px', opacity: 0.85, marginTop: '2mm', whiteSpace: 'pre-line' }}>{design.back_text}</p>}
        </div>
        {qrSvg && <div aria-label="QR code" role="img" style={{ width: '22mm', height: '22mm', background: '#fff', padding: '1.5mm', borderRadius: '1.5mm', flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: qrSvg }} />}
      </section>
    </div>
  );
}
