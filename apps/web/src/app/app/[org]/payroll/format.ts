export const STATUS_TONE = { draft: 'neutral', computed: 'warning', approved: 'primary', locked: 'success', cancelled: 'neutral' } as const;
export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
