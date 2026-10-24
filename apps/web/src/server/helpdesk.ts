import 'server-only';
import { createClient } from './supabase';

/** Helpdesk tickets and the knowledge base. RLS: requesters see their own, assignees theirs, agents all. */

export const OPEN_STATUSES = ['open', 'in_progress', 'waiting'] as const;

export async function getTicketCategories(orgId: string, includeInactive = false) {
  const supabase = await createClient();
  let q = supabase.from('ticket_categories').select('id, name, default_assignee_id, is_active').eq('organization_id', orgId);
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q.order('name');
  if (error) throw new Error(`Failed to load ticket categories (${error.code})`);
  return data;
}

export async function listTickets(orgId: string, filter: { requesterId?: string; assigneeId?: string; open?: boolean } = {}) {
  const supabase = await createClient();
  let q = supabase.from('tickets')
    .select('id, number, requester_id, category_id, subject, priority, status, assignee_id, sla_due_at, breached_at, created_at, updated_at')
    .eq('organization_id', orgId);
  if (filter.requesterId) q = q.eq('requester_id', filter.requesterId);
  if (filter.assigneeId) q = q.eq('assignee_id', filter.assigneeId);
  if (filter.open) q = q.in('status', [...OPEN_STATUSES]);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load tickets (${error.code})`);
  return data;
}

export async function getTicket(orgId: string, ticketId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('tickets').select('*').eq('organization_id', orgId).eq('id', ticketId).maybeSingle();
  if (error) throw new Error(`Failed to load the ticket (${error.code})`);
  return data;
}

/** The conversation with author names; internal notes are included only for agents on the ticket. */
export async function ticketThread(ticketId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ticket_thread', { p_ticket: ticketId });
  if (error) throw new Error(`Failed to load the conversation (${error.code})`);
  return data;
}

export async function searchKnowledge(orgId: string, query: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_kb', { p_org: orgId, p_query: query });
  if (error) throw new Error(`Failed to search the knowledge base (${error.code})`);
  return data;
}

export async function listArticles(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('kb_articles').select('id, title, category, published, updated_at')
    .eq('organization_id', orgId).order('updated_at', { ascending: false }).limit(200);
  if (error) throw new Error(`Failed to load articles (${error.code})`);
  return data;
}

export async function getArticle(orgId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('kb_articles').select('id, title, body, category, published, updated_at')
    .eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load the article (${error.code})`);
  return data;
}

/** The files on a ticket the caller can see (requesters: not agents' internal files). */
export async function ticketFiles(ticketId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('ticket_files', { p_ticket: ticketId });
  if (error) throw new Error(`Failed to load the ticket's files (${error.code})`);
  return data;
}

export const DEFAULT_HELPDESK_SETTINGS = {
  business_hours: false, day_start: '09:30:00', day_end: '18:30:00', urgent_hours: 4, high_hours: 8, normal_hours: 24, low_hours: 72,
};

/** Response targets: hours per priority, and whether they count business hours only (defaults until saved). */
export async function getHelpdeskSettings(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('helpdesk_settings')
    .select('business_hours, day_start, day_end, urgent_hours, high_hours, normal_hours, low_hours').eq('organization_id', orgId).maybeSingle();
  if (error) throw new Error(`Failed to load helpdesk settings (${error.code})`);
  return data ?? DEFAULT_HELPDESK_SETTINGS;
}

/** The requester's rating of a ticket (the requester and the ticket's agents see it). */
export async function ticketFeedback(ticketId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('ticket_feedback').select('rating, comment, updated_at').eq('ticket_id', ticketId).maybeSingle();
  if (error) throw new Error(`Failed to load the rating (${error.code})`);
  return data;
}

/** Ratings over the last 90 days, for helpdesk managers. */
export async function helpdeskSatisfaction(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('helpdesk_satisfaction', { p_org: orgId, p_days: 90 }).single();
  if (error) throw new Error(`Failed to load satisfaction (${error.code})`);
  return data;
}
