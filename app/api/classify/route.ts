import { NextRequest, NextResponse } from 'next/server';
import { VIBE_CATEGORIES } from '@/app/tools/shows/lib/vibeCategories';
import { geminiEndpoint } from '@/app/lib/aiConfig';

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
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
    `Return only a JSON array of strings. No prose, no markdown, no code fences.`;

  let geminiRes: Response;
  try {
    geminiRes = await fetch(geminiEndpoint(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Gemini request failed (network): ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  if (!geminiRes.ok) {
    const text = await geminiRes.text().catch(() => '');
    return NextResponse.json(
      { error: `Gemini error ${geminiRes.status}: ${text.slice(0, 400)}` },
      { status: 502 },
    );
  }

  const data = await geminiRes.json();
  const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';
  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').trim();

  let tags: unknown;
  try {
    tags = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      { error: `AI returned non-JSON: ${cleaned.slice(0, 200)}` },
      { status: 502 },
    );
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
