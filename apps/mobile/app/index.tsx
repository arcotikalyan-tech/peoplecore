import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '@/lib/session';

export default function Index() {
  const { loading, session, needsCode } = useSession();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <Redirect href={session && !needsCode ? '/(app)' : '/sign-in'} />;
}
