export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchTmdbDetails,
  fetchAnilistById,
  fetchJikanById,
  fetchTvMazeById,
} from '@/app/tools/shows/lib/mediaMetadata';
import { buildResolvedClassification } from '@/app/tools/shows/lib/titleResolver';
import { getTmdbConfig, hasTmdbCredentials } from '@/app/tools/shows/lib/tmdbConfig';
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

  // mediaKind is needed for TMDb (TV vs movie endpoint differ).
  // The UI sends it from the disambiguation option.
  const mediaKind: MediaKind =
    typeof body.mediaKind === 'string' && body.mediaKind === 'movie' ? 'movie' : 'tv';

  // Cloudflare Secrets: TMDB_READ_ACCESS_TOKEN (preferred) or TMDB_API_KEY (fallback).
  const tmdbConfig = getTmdbConfig();

  try {
    let candidate: MetadataCandidate | null = null;

    if (source === 'tmdb') {
      if (!hasTmdbCredentials(tmdbConfig)) {
        return NextResponse.json(
          { status: 'not_found', message: 'TMDb credentials are not configured.' },
          { status: 404 },
        );
      }
      const details = await fetchTmdbDetails(sourceId, mediaKind, tmdbConfig);
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
      // Direct lookup by AniList numeric ID — no title-search fallback.
      candidate = await fetchAnilistById(sourceId);
    } else if (source === 'jikan') {
      // Direct lookup by MAL ID via Jikan v4.
      candidate = await fetchJikanById(sourceId);
    } else if (source === 'tvmaze') {
      // Direct lookup by TVMaze show ID.
      candidate = await fetchTvMazeById(sourceId);
    }

    if (!candidate) {
      return NextResponse.json(
        { status: 'not_found', message: 'Could not fetch details for that selection.' },
        { status: 404 },
      );
    }

    candidate.confidence = 1.0;
    const resolved = await buildResolvedClassification(candidate, tmdbConfig);
    return NextResponse.json(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resolve failed.';
    const safe = message
      .replace(/api_key=[^&\s]*/gi, 'api_key=***')
      .replace(/Bearer [A-Za-z0-9._-]{8,}/g, 'Bearer ***');
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
