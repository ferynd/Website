export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import {
  searchAnilistCandidates,
  searchJikanCandidates,
  searchTvMazeCandidates,
  fetchTmdbDetails,
} from '@/app/tools/shows/lib/mediaMetadata';
import { buildResolvedClassification } from '@/app/tools/shows/lib/titleResolver';
import type { ResolveRequestBody, MediaKind, MetadataCandidate } from '@/app/tools/shows/lib/classifyTypes';

const ALLOWED_SOURCES = new Set<string>(['tmdb', 'anilist', 'jikan', 'tvmaze']);

export async function POST(req: NextRequest) {
  let body: ResolveRequestBody & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const source = typeof body.source === 'string' ? body.source : '';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';

  if (!ALLOWED_SOURCES.has(source) || !sourceId) {
    return NextResponse.json({ error: 'source and sourceId are required.' }, { status: 400 });
  }

  // mediaKind is needed for TMDb fetch; the UI sends it from the disambiguation option
  const mediaKind: MediaKind =
    typeof body.mediaKind === 'string' && body.mediaKind === 'movie' ? 'movie' : 'tv';

  const tmdbApiKey = process.env.TMDB_API_KEY;

  try {
    let candidate: MetadataCandidate | null = null;

    if (source === 'tmdb' && tmdbApiKey) {
      const details = await fetchTmdbDetails(sourceId, mediaKind, tmdbApiKey);
      if (details.title) {
        candidate = {
          source: 'tmdb',
          sourceId,
          title: details.title,
          originalTitle: details.originalTitle,
          year: details.year,
          mediaKind,
          derivedType: details.derivedType ?? (mediaKind === 'movie' ? 'movie' : 'tv'),
          overview: details.overview ?? '',
          genres: details.genres ?? [],
          originCountries: details.originCountries ?? [],
          originalLanguage: details.originalLanguage,
          isAnimation: details.isAnimation ?? false,
          confidence: 1.0,
        };
      }
    } else if (source === 'anilist') {
      // Re-search AniList by ID isn't a simple REST call; we search by title stored in the option.
      // The UI should send `title` for non-TMDb sources.
      const titleHint = typeof body.title === 'string' ? body.title : '';
      if (titleHint) {
        const results = await searchAnilistCandidates(titleHint);
        candidate = results.find((c) => c.sourceId === sourceId) ?? results[0] ?? null;
      }
    } else if (source === 'jikan') {
      const titleHint = typeof body.title === 'string' ? body.title : '';
      if (titleHint) {
        const results = await searchJikanCandidates(titleHint);
        candidate = results.find((c) => c.sourceId === sourceId) ?? results[0] ?? null;
      }
    } else if (source === 'tvmaze') {
      const titleHint = typeof body.title === 'string' ? body.title : '';
      if (titleHint) {
        const results = await searchTvMazeCandidates(titleHint);
        candidate = results.find((c) => c.sourceId === sourceId) ?? results[0] ?? null;
      }
    }

    if (!candidate) {
      return NextResponse.json(
        { status: 'not_found', message: 'Could not fetch details for that selection.' },
        { status: 404 },
      );
    }

    candidate.confidence = 1.0;
    const resolved = await buildResolvedClassification(candidate, tmdbApiKey);
    return NextResponse.json(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resolve failed.';
    const safe = message.replace(/key=[^&\s]*/gi, 'key=***');
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
