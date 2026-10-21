import { NextResponse, type NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/public-origin';
import { createClient } from '@/server/supabase';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // This device only: signing out here shouldn't end the person's sessions elsewhere.
  await supabase.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/login', publicOrigin(request)), { status: 303 });
}
