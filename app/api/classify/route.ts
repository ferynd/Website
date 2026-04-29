// --- Configuration ---
// File: app/api/classify/route.ts
// GEMINI_URL: The endpoint targeting the specific model to use for the classification task.
// ---------------------

export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { VIBE_CATEGORIES } from '@/app/tools/shows/lib/vibeCategories';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured. Ensure it is set as a Secret in Cloudflare.' }, { status: 500 });
  }

  let body: { title?: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { title, type } = body;
  if (!title?.trim() || !type) {
    return NextResponse.json({ error: 'title and type are required.' }, { status: 400 });
  }

  const prompt =
    `Given the show or movie titled "${title.trim()}" (type: ${type}), pick 2 to 4 vibe tags ` +
    `from this exact list: ${VIBE_CATEGORIES.join(', ')}. ` +
    `Return ONLY a JSON array of strings.`;

  let geminiRes: Response;
  try {
    geminiRes = await fetch(`${GEMINI_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { 
            temperature: 0.2,
            response_mime_type: 'application/json'
        },
      }),
    });
  } catch {
    return NextResponse.json({ error: 'Gemini request failed (network).' }, { status: 502 });
  }

  if (!geminiRes.ok) {
    const text = await geminiRes.text().catch(() => '');
    return NextResponse.json(
      { error: `Gemini error ${geminiRes.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = await geminiRes.json();
  const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  const cleaned = jsonMatch ? jsonMatch[0] : raw;

  let tags: unknown;
  try {
    tags = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON.' }, { status: 502 });
  }

  if (!Array.isArray(tags)) {
    return NextResponse.json({ error: 'AI response was not an array.' }, { status: 502 });
  }

  const allowed = new Set<string>(VIBE_CATEGORIES);
  const valid = (tags as unknown[])
    .filter((t): t is string => typeof t === 'string' && allowed.has(t))
    .slice(0, 4);

  return NextResponse.json({ vibes: valid });
}
