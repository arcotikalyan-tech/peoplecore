import type { Option } from '@/components/ui/fields';

/** Countries an organization can be in (where PeopleCore's customers are), named in English. */
const CODES = [
  'IN', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH', 'SG', 'MY', 'ID', 'TH', 'PH', 'VN', 'LK', 'BD', 'NP', 'JP', 'AU', 'NZ',
  'GB', 'IE', 'DE', 'FR', 'NL', 'US', 'CA', 'ZA', 'KE', 'NG', 'EG',
];

export function countryOptions(current?: string): Option[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const codes = current && !CODES.includes(current) ? [...CODES, current] : CODES;
  return codes.map((c) => ({ value: c, label: names.of(c) ?? c })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The browser/Node list uses some old names (Asia/Calcutta); organizations store the current ones (Asia/Kolkata). */
const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv', 'America/Godthab': 'America/Nuuk', 'Atlantic/Faeroe': 'Atlantic/Faroe', 'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei', 'Pacific/Enderbury': 'Pacific/Kanton',
};

export function timezoneList(current?: string): string[] {
  const all = new Set(['UTC', ...Intl.supportedValuesOf('timeZone').map((t) => RENAMED[t] ?? t)]);
  if (current) all.add(current);
  return [...all].sort();
}
