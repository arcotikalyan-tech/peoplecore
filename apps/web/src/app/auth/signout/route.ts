import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/server/supabase';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // This device only: signing out here shouldn't end the person's sessions elsewhere.
  await supabase.auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
}
