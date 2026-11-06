import { punchPlace, type PunchLocation } from '@peoplecore/shared';

/**
 * Where a punch was made: its pin in Google Maps, with the exact coordinates and how sure the device was. `compact` is
 * the link alone, for a table with no room (the coordinates are its tooltip). Nothing reaches Google until it's clicked.
 */
export function PunchPlace({ punch, label, compact = false }: { punch: PunchLocation; label: string; compact?: boolean }) {
  const place = punchPlace(punch);
  if (!place) return <span className="text-muted">—</span>;
  const detail = place.accuracy ? `${place.coords} · ${place.accuracy}` : place.coords;
  return (
    <span className="inline-block">
      <a href={place.mapsUrl} target="_blank" rel="noreferrer" aria-label={`${label}, in Google Maps`} title={detail}
        className="whitespace-nowrap text-xs font-medium text-primary hover:underline">📍 {compact ? 'Map' : 'Google Maps'}</a>
      {!compact && <span className="block whitespace-nowrap text-xs tabular-nums text-muted">{detail}</span>}
    </span>
  );
}
