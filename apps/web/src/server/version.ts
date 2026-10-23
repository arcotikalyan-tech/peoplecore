import { buildInfo } from '@/lib/env';
import { formatDateTime } from '@/lib/format';

/**
 * Which build of PeopleCore is answering: the commit deploy/deploy.sh built on the server (or Vercel's), and when it
 * went live there, so anyone can tell whether a change has reached them. Account settings shows it.
 */
export function appVersion(timeZone: string): string {
  const { commit, deployedAt } = buildInfo();
  if (!commit) return 'PeopleCore · development build';
  const when = deployedAt && !Number.isNaN(Date.parse(deployedAt)) ? ` · updated ${formatDateTime(deployedAt, timeZone)}` : '';
  return `PeopleCore version ${commit.slice(0, 7)}${when}`;
}
