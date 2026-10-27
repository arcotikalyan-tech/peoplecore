import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';
import { LogoLoader } from '@/ui';

export default function Index() {
  const { loading, session, needsCode } = useSession();
  if (loading) return <LogoLoader />;
  return <Redirect href={session && !needsCode ? '/(app)' : '/sign-in'} />;
}
