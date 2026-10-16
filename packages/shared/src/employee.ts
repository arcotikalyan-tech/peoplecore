import { addMonths } from './dates.ts';

/** `EMP` + 42 + width 5 → `EMP00042`. Codes are unique per organization (enforced in the database). */
export function formatEmployeeCode(prefix: string, sequence: number, width = 5): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError('sequence must be a positive integer');
  return `${prefix}${String(sequence).padStart(width, '0')}`;
}

/**
 * Probation ends the day before the same calendar date `months` later
 * (joining 2026-01-15, 6 months → 2026-07-14). Returns null when there is no probation.
 */
export function computeProbationEndDate(dateOfJoining: string, months: number): string | null {
  if (months <= 0) return null;
  const sameDayLater = addMonths(dateOfJoining, months);
  const [y, m, d] = sameDayLater.split('-').map(Number) as [number, number, number];
  const previous = new Date(Date.UTC(y, m - 1, d - 1));
  return previous.toISOString().slice(0, 10);
}

export interface PersonName {
  first_name: string;
  middle_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
}

export function displayName(person: PersonName): string {
  const first = person.preferred_name?.trim() || person.first_name.trim();
  return [first, person.last_name?.trim()].filter(Boolean).join(' ');
}

export function legalName(person: PersonName): string {
  return [person.first_name, person.middle_name, person.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

export function initials(person: PersonName): string {
  const name = displayName(person);
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts.at(-1)![0]] : [parts[0]?.[0]];
  return letters.join('').toUpperCase();
}
