export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseIdToken } from '@/app/lib/verifyFirebaseAuth';
import { ADMIN_EMAIL } from '@/app/tools/trip-cost/firebaseConfig';

// Read-only status check for the Requirements panel — never touches
// transcript data or model APIs. Reports which of requireAdminUser's checks
// pass so the UI can explain *why* a request would fail before the admin
// runs the pipeline and hits it live. Server-side key presence is only
// revealed once the caller already clears the same email-match +
// email-verified bar requireAdminUser enforces, so this route can't be used
// to probe deployment config as an unverified or non-admin caller.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer (.+)$/i);

  const empty = {
    signedIn: false,
    emailMatches: false,
    emailVerified: false,
    email: null as string | null,
    transcribeKeyConfigured: null as boolean | null,
    correctionKeyConfigured: null as boolean | null,
  };

  if (!match) return NextResponse.json(empty);

  const payload = await verifyFirebaseIdToken(match[1]);
  if (!payload) return NextResponse.json(empty);

  const email = payload.email ?? null;
  const emailMatches = !!email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const emailVerified = payload.email_verified === true;
  const isAdmin = emailMatches && emailVerified;

  return NextResponse.json({
    signedIn: true,
    emailMatches,
    emailVerified,
    email,
    transcribeKeyConfigured: isAdmin ? !!process.env.GPT_API_KEY : null,
    correctionKeyConfigured: isAdmin ? !!process.env.GEMINI_API_KEY : null,
  });
}
