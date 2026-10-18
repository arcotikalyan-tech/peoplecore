/**
 * What agents may read, implemented by the caller. Every function runs AS THE ACTOR (the RLS client in the web
 * app), never with service-role privileges, so an agent can only see what the person asking can see.
 */

export interface KnowledgeHit {
  kind: 'article' | 'policy';
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  rank: number;
}

export interface DataPort {
  org: { id: string; name: string };
  /** Published knowledge-base articles and current policies matching the text, best first. */
  searchKnowledge(query: string): Promise<KnowledgeHit[]>;
}
