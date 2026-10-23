import Constants from 'expo-constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Which build of the app this is (version, commit, build date; stamped by app.config.js), for Account settings. */
export function appVersion(): string {
  const config = Constants.expoConfig;
  const build = config?.extra?.build as { commit?: string | null; builtAt?: string } | undefined;
  const at = build?.builtAt ? new Date(build.builtAt) : null;
  const date = at && !Number.isNaN(at.getTime()) ? ` · built ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}` : '';
  return `PeopleCore ${config?.version ?? ''}${build?.commit ? ` · build ${build.commit}` : ''}${date}`;
}
