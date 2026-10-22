/** Company profile lists, shared by the server page and the client forms (a client module's values can't be read on the server). */

export const ENTITY_TYPES = [
  { value: 'private_limited', label: 'Private Limited Company' }, { value: 'public_limited', label: 'Public Limited Company' },
  { value: 'llp', label: 'Limited Liability Partnership' }, { value: 'opc', label: 'One Person Company' }, { value: 'partnership', label: 'Partnership firm' },
  { value: 'proprietorship', label: 'Sole proprietorship' }, { value: 'section_8', label: 'Section 8 company' }, { value: 'trust', label: 'Trust' },
  { value: 'society', label: 'Society' }, { value: 'other', label: 'Other' },
];

/** Industry types (Kredily's list, a few more, and Other). */
export const INDUSTRIES = [
  'Agriculture', 'Automobile', 'Banking and Finance', 'Construction', 'Education', 'Energy', 'Entertainment and Media',
  'Fast-Moving Consumer Goods (FMCG)', 'Healthcare', 'Hospitality', 'Information Technology (IT)', 'Logistics and Transport',
  'Non-profit', 'Pharmaceuticals', 'Professional Services', 'Real Estate', 'Retail', 'Space and Aerospace', 'Steel and Manufacturing',
  'Telecommunications', 'Textiles and Garments', 'Tourism', 'Other',
];

export const COMPANY_PROOFS = [
  { kind: 'pan', label: 'Company PAN' }, { kind: 'tan', label: 'TAN' }, { kind: 'cin', label: 'Certificate of incorporation (CIN)' },
  { kind: 'gst', label: 'GST registration' }, { kind: 'pf', label: 'PF registration' }, { kind: 'esi', label: 'ESI registration' },
  { kind: 'other', label: 'Other' },
] as const;
