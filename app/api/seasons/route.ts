export const runtime = 'edge';
import { NextRequest, NextResponse } from 'next/server';
import { searchTmdbCandidates, fetchTmdbTvSeasonInfo } from '@/app/tools/shows/lib/mediaMetadata';
import { getTmdbConfig, hasTmdbCredentials } from '@/app/tools/shows/lib/tmdbConfig';
import { titleSimilarity } from '@/app/tools/shows/lib/titleResolver';
import { evaluateSeasonResult, MAX_SEASON_CHECK_BATCH } from '@/app/tools/shows/lib/seasonCheck';
import { mapWithConcurrency } from '@/app/tools/shows/lib/concurrency';
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

// Each unmatched show can cost a search + details call — limit how many run
// concurrently so a large batch doesn't spike TMDb rate limits or time out.
const CONCURRENCY = 5;

function titleCloseMatch(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= FALLBACK_MATCH_THRESHOLD;
}

type SeasonCheckOutcome =
  | { showId: string; matched: true; tmdbId: string; recordedSeasons: number | null; latestSeasons: number; hasNewSeason: boolean; airingStatus: string; nextAirDate: string | null; lastAirDate: string | null }
  | { showId: string; matched: false; reason: 'no_confident_match' | 'lookup_failed' | 'error' };

async function checkOne(show: SeasonCheckRequestShow, tmdbConfig: ReturnType<typeof getTmdbConfig>): Promise<SeasonCheckOutcome> {
  try {
    let tmdbId = show.metadataSource === 'tmdb' ? show.metadataSourceId ?? null : null;

    if (!tmdbId) {
      const candidates = await searchTmdbCandidates(show.title, tmdbConfig);
      const tvCandidates = candidates.filter((c) => c.mediaKind === 'tv');
      const match = tvCandidates.find((c) => titleCloseMatch(c.title, show.title));
      if (match) tmdbId = match.sourceId;
    }

    if (!tmdbId) {
      return { showId: show.id, matched: false, reason: 'no_confident_match' };
    }

    const info = await fetchTmdbTvSeasonInfo(tmdbId, tmdbConfig);
    if (!info) {
      return { showId: show.id, matched: false, reason: 'lookup_failed' };
    }

    const result = evaluateSeasonResult({
      showId: show.id,
      recordedSeasons: show.recordedSeasons,
      latestSeasons: info.numberOfSeasons,
      tmdbStatus: info.status,
      nextAirDate: info.nextAirDate,
      lastAirDate: info.lastAirDate,
    });

    return { ...result, matched: true, tmdbId };
  } catch {
    return { showId: show.id, matched: false, reason: 'error' };
  }
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
  if (shows.length > MAX_SEASON_CHECK_BATCH) {
    return NextResponse.json(
      { error: `Too many shows in one request (max ${MAX_SEASON_CHECK_BATCH}).` },
      { status: 400 },
    );
  }

  const tmdbConfig = getTmdbConfig();
  if (!hasTmdbCredentials(tmdbConfig)) {
    return NextResponse.json(
      { error: 'TMDb credentials are not configured, so season checks are unavailable.' },
      { status: 501 },
    );
  }

  const payload = await mapWithConcurrency(shows, CONCURRENCY, (show) => checkOne(show, tmdbConfig));

  return NextResponse.json({ results: payload });
}
