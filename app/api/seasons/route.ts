export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { searchTmdbCandidates, fetchTmdbTvSeasonInfo } from '@/app/tools/shows/lib/mediaMetadata';
import { getTmdbConfig, hasTmdbCredentials } from '@/app/tools/shows/lib/tmdbConfig';
import { titleSimilarity } from '@/app/tools/shows/lib/titleResolver';
import { evaluateSeasonResult } from '@/app/tools/shows/lib/seasonCheck';
import type { MetadataSource } from '@/app/tools/shows/types';

interface SeasonCheckRequestShow {
  id: string;
  title: string;
  recordedSeasons: number | null;
  metadataSource?: MetadataSource | null;
  metadataSourceId?: string | null;
}

// A live title-search fallback (for shows classified before source/sourceId were
// persisted) only counts as a match when the top TMDb TV result's title is a very
// close match — otherwise we'd risk flagging the wrong series' season count.
const FALLBACK_MATCH_THRESHOLD = 0.9;

function titleCloseMatch(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= FALLBACK_MATCH_THRESHOLD;
}

export async function POST(req: NextRequest) {
  let body: { shows?: SeasonCheckRequestShow[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const shows = Array.isArray(body.shows) ? body.shows : [];
  if (shows.length === 0) {
    return NextResponse.json({ error: 'shows is required.' }, { status: 400 });
  }

  const tmdbConfig = getTmdbConfig();
  if (!hasTmdbCredentials(tmdbConfig)) {
    return NextResponse.json(
      { error: 'TMDb credentials are not configured, so season checks are unavailable.' },
      { status: 501 },
    );
  }

  const results = await Promise.allSettled(
    shows.map(async (show) => {
      let tmdbId = show.metadataSource === 'tmdb' ? show.metadataSourceId ?? null : null;

      if (!tmdbId) {
        const candidates = await searchTmdbCandidates(show.title, tmdbConfig);
        const tvCandidates = candidates.filter((c) => c.mediaKind === 'tv');
        const match = tvCandidates.find((c) => titleCloseMatch(c.title, show.title));
        if (match) tmdbId = match.sourceId;
      }

      if (!tmdbId) {
        return { showId: show.id, matched: false as const, reason: 'no_confident_match' as const };
      }

      const info = await fetchTmdbTvSeasonInfo(tmdbId, tmdbConfig);
      if (!info) {
        return { showId: show.id, matched: false as const, reason: 'lookup_failed' as const };
      }

      const result = evaluateSeasonResult({
        showId: show.id,
        recordedSeasons: show.recordedSeasons,
        latestSeasons: info.numberOfSeasons,
        tmdbStatus: info.status,
        nextAirDate: info.nextAirDate,
        lastAirDate: info.lastAirDate,
      });

      return { ...result, matched: true as const, tmdbId };
    }),
  );

  const payload = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { showId: shows[i].id, matched: false as const, reason: 'error' as const },
  );

  return NextResponse.json({ results: payload });
}
