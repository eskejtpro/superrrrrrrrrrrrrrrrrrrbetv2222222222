import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.resolve(__dirname, 'web');

const HOST = '0.0.0.0';
const PORT = 3000;
const MAX_HISTORY_PER_MATCH = 200;

interface NormalizedMatch {
  key: string;
  competition: string;
  format_minutes: number | null;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  half: number;
  clock_seconds: number;
  clock_label: string;
  status: string;
  is_live: boolean;
  source_url: string;
  observed_at: string;
  started_at: string | null;
  estimated_end_at: string | null;
  added_time_seconds: number;
  break_seconds: number;
  added_time_note: string;
  in_break?: boolean;
  in_added_time?: boolean;
  last_scorer_side?: 'home' | 'away' | null;
  remaining_seconds: number | null;
  score_label: string;
  half_label: string;
  analysis?: string;
}

interface Settings {
  ui_refresh_seconds: number;
  theme: 'dark' | 'light';
  default_sort: 'remaining' | 'clock' | 'name' | 'score';
  compact_mode: boolean;
  show_paused: boolean;
  highlight_row_tint: boolean;
  highlight_enabled: boolean;
  highlight_goal_difference: number;
  highlight_remaining_seconds: number;
  highlight_color: string;
  potential_enabled: boolean;
  potential_goal_difference: number;
  potential_remaining_seconds: number;
  potential_min_total_goals: number;
  potential_color: string;
  high_scoring_enabled: boolean;
  high_scoring_min_goals: number;
  high_scoring_color: string;
  close_finish_enabled: boolean;
  close_finish_remaining_seconds: number;
  close_finish_color: string;
  notify_enabled: boolean;
  notify_potential: boolean;
  notify_primary: boolean;
  notify_high_scoring: boolean;
  notify_close_finish: boolean;
  notify_sound: boolean;
  notify_cooldown_seconds: number;
}

const DEFAULT_SETTINGS: Settings = {
  ui_refresh_seconds: 20,
  theme: 'dark',
  default_sort: 'remaining',
  compact_mode: false,
  show_paused: true,
  highlight_row_tint: true,
  highlight_enabled: true,
  highlight_goal_difference: 3,
  highlight_remaining_seconds: 90,
  highlight_color: '#dc2626',
  potential_enabled: true,
  potential_goal_difference: 2,
  potential_remaining_seconds: 300,
  potential_min_total_goals: 2,
  potential_color: '#f59e0b',
  high_scoring_enabled: true,
  high_scoring_min_goals: 5,
  high_scoring_color: '#8b5cf6',
  close_finish_enabled: true,
  close_finish_remaining_seconds: 120,
  close_finish_color: '#0ea5e9',
  notify_enabled: true,
  notify_potential: true,
  notify_primary: true,
  notify_high_scoring: false,
  notify_close_finish: false,
  notify_sound: true,
  notify_cooldown_seconds: 120,
};

function utcNow(): string {
  return new Date().toISOString();
}

function parseIntValue(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function remainingSeconds(match: {
  format_minutes: number | null;
  clock_seconds: number | null;
  half: number | null;
}): number | null {
  const totalMinutes = parseIntValue(match.format_minutes);
  const clock = parseIntValue(match.clock_seconds);
  const half = parseIntValue(match.half);
  if (totalMinutes === null || totalMinutes <= 0 || totalMinutes % 2 !== 0) {
    return null;
  }
  if ((half !== 1 && half !== 2) || clock === null || clock < 0) {
    return null;
  }
  const halfSeconds = Math.floor(totalMinutes / 2) * 60;
  if (clock > halfSeconds) {
    return null;
  }
  return Math.max((2 - half) * halfSeconds + (halfSeconds - clock), 0);
}

function buildAddedTimeNote(addedSec: number, breakSec: number, customNote?: string): string {
  if (customNote && customNote.trim()) {
    return customNote.trim();
  }
  const parts: string[] = [];
  if (addedSec > 0) {
    parts.push(`Doliczony czas: +${addedSec} s`);
  }
  if (breakSec > 0) {
    parts.push(`Przerwa w połowie: ${breakSec} s`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Brak doliczonego czasu i przerw';
}

function normalizeMatch(raw: Record<string, unknown>, observedAt: string): NormalizedMatch {
  const home = String(raw.home ?? '').trim();
  const away = String(raw.away ?? '').trim();
  if (!home || !away) {
    throw new Error('Brak nazw drużyn');
  }
  const sourceUrl = String(raw.url ?? '').trim();
  const half = parseIntValue(raw.half);
  const clockSeconds = parseIntValue(raw.clock);
  if ((half !== 1 && half !== 2) || clockSeconds === null || clockSeconds < 0) {
    throw new Error('Spotkanie nie ma potwierdzonego statusu LIVE');
  }
  const competitionRaw = String(raw.competition ?? '').trim();
  const statusRaw = String(raw.status ?? '');
  const formatMinutes = parseIntValue(raw.formatMinutes);
  const homeScore = parseIntValue(raw.homeScore);
  const awayScore = parseIntValue(raw.awayScore);
  const addedTimeSeconds = Math.max(0, parseIntValue(raw.addedTimeSeconds ?? raw.addedTime ?? raw.extraSeconds) ?? 0);
  const breakSeconds = Math.max(0, parseIntValue(raw.breakSeconds ?? raw.halftimeBreakSeconds) ?? 0);
  const addedTimeNote = buildAddedTimeNote(
    addedTimeSeconds,
    breakSeconds,
    typeof raw.addedTimeNote === 'string' ? raw.addedTimeNote : undefined,
  );

  const regularRemaining = remainingSeconds({
    format_minutes: formatMinutes,
    clock_seconds: clockSeconds,
    half,
  });
  const totalRemaining =
    regularRemaining !== null
      ? regularRemaining + addedTimeSeconds + (half === 1 ? breakSeconds : 0)
      : null;

  const observedMs = Date.parse(observedAt);
  let startedAt: string | null = null;
  if (typeof raw.startedAt === 'string' && !Number.isNaN(Date.parse(raw.startedAt))) {
    startedAt = new Date(Date.parse(raw.startedAt)).toISOString();
  } else if (!Number.isNaN(observedMs)) {
    const halfSec =
      formatMinutes !== null && formatMinutes > 0 && formatMinutes % 2 === 0
        ? (formatMinutes / 2) * 60
        : 0;
    const elapsedFromStart =
      halfSec > 0
        ? (half - 1) * halfSec + Math.min(clockSeconds, halfSec) + (half === 2 ? breakSeconds : 0)
        : clockSeconds + (half === 2 ? breakSeconds : 0);
    startedAt = new Date(observedMs - elapsedFromStart * 1000).toISOString();
  }

  const estimatedEndAt =
    totalRemaining !== null && !Number.isNaN(observedMs)
      ? new Date(observedMs + totalRemaining * 1000).toISOString()
      : null;

  const match: NormalizedMatch = {
    key: `${sourceUrl}|${home}|${away}`,
    competition: competitionRaw || 'e-Piłka nożna live',
    format_minutes: formatMinutes,
    home,
    away,
    home_score: homeScore,
    away_score: awayScore,
    half,
    clock_seconds: clockSeconds,
    clock_label: String(raw.clockLabel ?? ''),
    status: statusRaw || 'aktywny',
    is_live: true,
    source_url: sourceUrl,
    observed_at: observedAt,
    started_at: startedAt,
    estimated_end_at: estimatedEndAt,
    added_time_seconds: addedTimeSeconds,
    break_seconds: breakSeconds,
    added_time_note: addedTimeNote,
    in_break: false,
    in_added_time: false,
    remaining_seconds: totalRemaining,
    score_label:
      homeScore !== null && awayScore !== null ? `${homeScore}:${awayScore}` : 'brak',
    half_label: half ? `${half}. połowa` : 'brak',
  };
  return match;
}

function describeChange(match: NormalizedMatch, old: NormalizedMatch | undefined): string {
  const score =
    match.home_score !== null && match.away_score !== null
      ? `${match.home_score}:${match.away_score}`
      : 'brak wyniku';
  const base = `${match.home} — ${match.away}: ${score}; ${match.half || 'brak'}. połowa; czas ${match.clock_label || 'brak'}.`;
  if (!old) {
    return `${base} Nowy mecz wykryty w źródle live.`;
  }
  const oldScore = `${old.home_score}:${old.away_score}`;
  const updates: string[] = [];
  if (score !== oldScore) {
    updates.push(`wynik zmienił się z ${oldScore} na ${score}`);
  }
  if (match.half !== old.half) {
    updates.push('zmiana połowy');
  }
  if (match.status !== old.status) {
    updates.push(`status: ${match.status}`);
  }
  return updates.length > 0
    ? `${base} Zmiana: ${updates.join('; ')}.`
    : `${base} Brak istotnej zmiany od poprzedniego odczytu.`;
}

// In-memory store replacing local SQLite + settings.json for container runtime
const historyByMatchKey = new Map<string, NormalizedMatch[]>();
let currentMatches = new Map<string, NormalizedMatch>();
let currentAnalysis = new Map<string, string>();
let lastReceivedAt: string | null = null;
let lastSourceCount = 0;
let isDemoMode = false;
let superbetTimeOffsetMs = 0;
let lastSuperbetTimeLabel: string | null = null;
let currentSettings: Settings = { ...DEFAULT_SETTINGS };

function ingestMatches(rawMatches: unknown[], observedAtOverride?: string): number {
  const receivedAt = observedAtOverride ?? utcNow();
  const normalized: NormalizedMatch[] = [];
  for (const item of rawMatches) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    try {
      normalized.push(normalizeMatch(item as Record<string, unknown>, receivedAt));
    } catch {
      continue;
    }
  }

  const previous = currentMatches;
  const nextMatches = new Map<string, NormalizedMatch>();
  const nextAnalysis = new Map<string, string>();
  for (const match of normalized) {
    nextMatches.set(match.key, match);
    nextAnalysis.set(match.key, describeChange(match, previous.get(match.key)));

    const list = historyByMatchKey.get(match.key) ?? [];
    list.push({ ...match });
    if (list.length > MAX_HISTORY_PER_MATCH) {
      list.splice(0, list.length - MAX_HISTORY_PER_MATCH);
    }
    historyByMatchKey.set(match.key, list);
  }

  currentMatches = nextMatches;
  currentAnalysis = nextAnalysis;
  lastReceivedAt = receivedAt;
  lastSourceCount = rawMatches.length;

  return normalized.length;
}

function compareRemaining(a: NormalizedMatch, b: NormalizedMatch): number {
  const aMissing = a.remaining_seconds === null ? 1 : 0;
  const bMissing = b.remaining_seconds === null ? 1 : 0;
  if (aMissing !== bMissing) {
    return aMissing - bMissing;
  }
  const aSec = a.remaining_seconds ?? Number.MAX_SAFE_INTEGER;
  const bSec = b.remaining_seconds ?? Number.MAX_SAFE_INTEGER;
  if (aSec !== bSec) {
    return aSec - bSec;
  }
  const aHome = a.home.toLowerCase();
  const bHome = b.home.toLowerCase();
  if (aHome !== bHome) {
    return aHome.localeCompare(bHome);
  }
  return a.key.localeCompare(b.key);
}

function clearMatchesState(): void {
  historyByMatchKey.clear();
  currentMatches = new Map<string, NormalizedMatch>();
  currentAnalysis = new Map<string, string>();
  lastReceivedAt = null;
  lastSourceCount = 0;
  isDemoMode = false;
  superbetTimeOffsetMs = 0;
  lastSuperbetTimeLabel = null;
}

function seedDemoMatches(): number {
  clearMatchesState();
  const prevTime = new Date(Date.now() - 20_000).toISOString();
  const nowTime = utcNow();

  const previousSnapshot: Array<Record<string, unknown>> = [
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-1',
      competition: 'EA Sports FC 25 · 2x5 min [DEMO]',
      home: 'Gracz Alpha',
      away: 'Gracz Beta',
      homeScore: 4,
      awayScore: 1,
      half: 2,
      clock: 235,
      clockLabel: "9' (03:55)",
      formatMinutes: 10,
      addedTimeSeconds: 30,
      breakSeconds: 30,
      addedTimeNote: 'Doliczony czas: +30 s · Przerwa w połowie: 30 s',
      status: 'aktywny',
      isLive: true,
    },
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-2',
      competition: 'e-Piłka nożna · Volta 2x4 min [DEMO]',
      home: 'Real_eSport',
      away: 'City_Pro',
      homeScore: 0,
      awayScore: 2,
      half: 2,
      clock: 145,
      clockLabel: "7' (02:25)",
      formatMinutes: 8,
      addedTimeSeconds: 15,
      breakSeconds: 30,
      addedTimeNote: 'Doliczony czas: +15 s · Przerwa w połowie: 30 s',
      status: 'aktywny',
      isLive: true,
    },
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-3',
      competition: 'GT Sports League · 2x6 min [DEMO]',
      home: 'Kowalski_PL',
      away: 'Nowak_FIFA',
      homeScore: 2,
      awayScore: 2,
      half: 2,
      clock: 260,
      clockLabel: "11' (04:20)",
      formatMinutes: 12,
      addedTimeSeconds: 45,
      breakSeconds: 45,
      addedTimeNote: 'Przerwa techniczna / doliczony czas: +45 s',
      status: 'aktywny',
      isLive: true,
    },
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-4',
      competition: 'e-Piłka Pro Cup · 2x8 min [DEMO]',
      home: 'Arsenal_eFC',
      away: 'Inter_eFC',
      homeScore: 3,
      awayScore: 2,
      half: 2,
      clock: 190,
      clockLabel: "12' (03:10)",
      formatMinutes: 16,
      addedTimeSeconds: 0,
      breakSeconds: 45,
      addedTimeNote: 'Przerwa w połowie: 45 s · brak doliczonego czasu',
      status: 'aktywny',
      isLive: true,
    },
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-5',
      competition: 'EA Sports FC 25 · 2x5 min [DEMO]',
      home: 'PSG_eSports',
      away: 'Bayern_eSports',
      homeScore: 1,
      awayScore: 0,
      half: 1,
      clock: 160,
      clockLabel: "3' (02:40)",
      formatMinutes: 10,
      addedTimeSeconds: 30,
      breakSeconds: 45,
      addedTimeNote: 'Przed przerwą (45 s) + szacowany doliczony czas: +30 s',
      status: 'aktywny',
      isLive: true,
    },
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-6',
      competition: 'Liga Mistrzów e-Piłka · 2x10 min [DEMO]',
      home: 'FC Vortex',
      away: 'Apex United',
      homeScore: 1,
      awayScore: 1,
      half: 1,
      clock: 90,
      clockLabel: "2' (01:30)",
      formatMinutes: 20,
      addedTimeSeconds: 60,
      breakSeconds: 60,
      addedTimeNote: 'Przerwa w połowie: 60 s · szacowany doliczony czas: +60 s',
      status: 'oferta wstrzymana',
      isLive: true,
    },
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-7',
      competition: 'Turniej Specjalny · format nieznany [DEMO]',
      home: 'Team_X',
      away: 'Team_Y',
      homeScore: 4,
      awayScore: 3,
      half: 2,
      clock: 290,
      clockLabel: "14' (04:50)",
      formatMinutes: null,
      addedTimeSeconds: 20,
      breakSeconds: 0,
      addedTimeNote: 'Doliczony czas: +20 s · format nieznany',
      status: 'aktywny',
      isLive: true,
    },
    {
      url: 'https://superbet.pl/zaklady-bukmacherskie/e-pilka-nozna/live/demo-8',
      competition: 'Ekstraklasa e-Piłka · 2x6 min [DEMO]',
      home: 'Lech_eFC',
      away: 'Legia_eFC',
      homeScore: 3,
      awayScore: 2,
      half: 2,
      clock: 245,
      clockLabel: "11' (04:05)",
      formatMinutes: 12,
      addedTimeSeconds: 30,
      breakSeconds: 30,
      addedTimeNote: 'Doliczony czas: +30 s · Przerwa w połowie: 30 s',
      status: 'aktywny',
      isLive: true,
    },
  ];

  const currentSnapshot: Array<Record<string, unknown>> = [
    {
      ...previousSnapshot[0],
      homeScore: 5,
      awayScore: 1,
      clock: 255,
      clockLabel: "10' (04:15)",
    },
    {
      ...previousSnapshot[1],
      homeScore: 0,
      awayScore: 3,
      clock: 165,
      clockLabel: "7' (02:45)",
    },
    {
      ...previousSnapshot[2],
      clock: 280,
      clockLabel: "11' (04:40)",
      status: 'oferta wstrzymana',
    },
    {
      ...previousSnapshot[3],
      clock: 210,
      clockLabel: "12' (03:30)",
    },
    {
      ...previousSnapshot[4],
      homeScore: 2,
      awayScore: 0,
      clock: 180,
      clockLabel: "3' (03:00)",
    },
    {
      ...previousSnapshot[5],
      clock: 110,
      clockLabel: "2' (01:50)",
    },
    {
      ...previousSnapshot[6],
      clock: 310,
      clockLabel: "05:10",
    },
    {
      ...previousSnapshot[7],
      homeScore: 4,
      awayScore: 2,
      clock: 265,
      clockLabel: "11' (04:25)",
    },
  ];

  ingestMatches(previousSnapshot, prevTime);
  const accepted = ingestMatches(currentSnapshot, nowTime);
  isDemoMode = true;
  return accepted;
}

function formatClockLabel(half: number, clockSec: number, formatMinutes: number | null): string {
  const mm = String(Math.floor(clockSec / 60)).padStart(2, '0');
  const ss = String(clockSec % 60).padStart(2, '0');
  if (formatMinutes !== null && formatMinutes > 0 && formatMinutes % 2 === 0) {
    const halfSeconds = (formatMinutes / 2) * 60;
    const totalMatchSec = (half - 1) * halfSeconds + clockSec;
    const matchMinute = Math.max(1, Math.ceil(totalMatchSec / 60));
    return `${matchMinute}' (${mm}:${ss})`;
  }
  return `${mm}:${ss}`;
}

function projectMatchAt(match: NormalizedMatch, atMs: number, wrapDemo: boolean): NormalizedMatch {
  const observedMs = Date.parse(match.observed_at);
  if (Number.isNaN(observedMs)) {
    return match;
  }
  const elapsed = Math.max(0, Math.floor((atMs - observedMs) / 1000));
  if (elapsed === 0) {
    return match;
  }

  const totalMinutes = match.format_minutes;
  const addedSec = Math.max(0, match.added_time_seconds || 0);
  const breakSec = Math.max(0, match.break_seconds || 0);

  if (totalMinutes !== null && totalMinutes > 0 && totalMinutes % 2 === 0 && (match.half === 1 || match.half === 2)) {
    const halfSeconds = (totalMinutes / 2) * 60;
    const totalRegular = totalMinutes * 60;
    const totalCycle = totalRegular + breakSec + addedSec;
    const baseElapsedFromStart =
      (match.half - 1) * halfSeconds +
      Math.min(match.clock_seconds, halfSeconds) +
      (match.half === 2 ? breakSec : 0);

    let pos = baseElapsedFromStart + elapsed;
    if (wrapDemo) {
      pos = pos % totalCycle;
    } else {
      pos = Math.min(pos, totalCycle);
    }

    let projectedHalf = 1;
    let projectedClock = 0;
    let inBreak = false;
    let inAdded = false;
    let halfLabel = '1. połowa';

    if (pos < halfSeconds) {
      projectedHalf = 1;
      projectedClock = pos;
      halfLabel = '1. połowa';
    } else if (breakSec > 0 && pos < halfSeconds + breakSec) {
      projectedHalf = 1;
      projectedClock = halfSeconds;
      inBreak = true;
      halfLabel = 'Przerwa';
    } else if (pos < totalRegular + breakSec) {
      projectedHalf = 2;
      projectedClock = pos - (halfSeconds + breakSec);
      halfLabel = '2. połowa';
    } else {
      projectedHalf = 2;
      projectedClock = halfSeconds;
      inAdded = addedSec > 0;
      halfLabel = addedSec > 0 ? '2. połowa (doliczony)' : '2. połowa';
    }

    const projectedRemaining = Math.max(0, totalCycle - pos);
    const startedAt = new Date(atMs - pos * 1000).toISOString();
    const estimatedEndAt = new Date(atMs + projectedRemaining * 1000).toISOString();
    const extraSec = inAdded ? Math.max(0, pos - (totalRegular + breakSec)) : 0;
    const baseClockLabel = formatClockLabel(projectedHalf, projectedClock, totalMinutes);
    const clockLabel = inBreak
      ? `Przerwa (${pos - halfSeconds}s / ${breakSec}s)`
      : inAdded
        ? `${baseClockLabel} +${extraSec}s`
        : baseClockLabel;

    return {
      ...match,
      half: projectedHalf,
      half_label: halfLabel,
      clock_seconds: projectedClock,
      clock_label: clockLabel,
      in_break: inBreak,
      in_added_time: inAdded,
      started_at: startedAt,
      estimated_end_at: estimatedEndAt,
      remaining_seconds: projectedRemaining,
    };
  }

  const projectedClock = match.clock_seconds + elapsed;
  return {
    ...match,
    clock_seconds: projectedClock,
    clock_label: formatClockLabel(match.half, projectedClock, null),
  };
}

function lastScorerSide(matchKey: string): 'home' | 'away' | null {
  const history = historyByMatchKey.get(matchKey);
  if (!history || history.length < 2) {
    return null;
  }
  for (let i = history.length - 1; i > 0; i -= 1) {
    const curr = history[i];
    const prev = history[i - 1];
    if (
      curr.home_score !== null &&
      prev.home_score !== null &&
      curr.away_score !== null &&
      prev.away_score !== null
    ) {
      if (curr.home_score > prev.home_score) {
        return 'home';
      }
      if (curr.away_score > prev.away_score) {
        return 'away';
      }
    }
  }
  return null;
}

function livePayload() {
  const nowMs = Date.now();
  const matches: NormalizedMatch[] = Array.from(currentMatches.values()).map((match) => {
    const projected = projectMatchAt(match, nowMs, isDemoMode);
    return {
      ...projected,
      last_scorer_side: lastScorerSide(match.key),
      analysis: currentAnalysis.get(match.key) ?? 'Brak analizy.',
    };
  });
  matches.sort(compareRemaining);

  let ageSeconds: number | null = null;
  if (lastReceivedAt) {
    const parsed = Date.parse(lastReceivedAt);
    if (!Number.isNaN(parsed)) {
      const elapsed = Math.max(0, Math.floor((nowMs - parsed) / 1000));
      ageSeconds = isDemoMode ? elapsed % 20 : elapsed;
    }
  }
  const sourceOnline = ageSeconds !== null && ageSeconds <= 50;
  const visibleMatches = sourceOnline ? matches : [];

  return {
    matches: visibleMatches,
    count: visibleMatches.length,
    source_count: lastSourceCount,
    received_at: lastReceivedAt,
    server_time: utcNow(),
    superbet_time: new Date(nowMs + superbetTimeOffsetMs).toISOString(),
    superbet_time_label: lastSuperbetTimeLabel,
    superbet_snapshot_at: lastReceivedAt,
    source_age_seconds: ageSeconds,
    source_online: sourceOnline,
    source_status: sourceOnline ? 'online' : lastReceivedAt ? 'stale' : 'waiting',
    source_interval_seconds: 20,
    is_demo: isDemoMode,
  };
}

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const app = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err && typeof err === 'object' && 'status' in err) {
    res.status(400).json({ error: 'Niepoprawne dane JSON' });
    return;
  }
  next(err);
});

app.get('/api/live', (_req: Request, res: Response) => {
  res.json(livePayload());
});

app.get('/api/health', (_req: Request, res: Response) => {
  const payload = livePayload();
  res.json({
    ok: true,
    received_at: payload.received_at,
    match_count: payload.count,
  });
});

app.get('/api/history', (req: Request, res: Response) => {
  const key = typeof req.query.match_key === 'string' ? req.query.match_key : '';
  const rawLimit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 30;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30;
  if (!key) {
    res.json({ history: [] });
    return;
  }
  const all = historyByMatchKey.get(key) ?? [];
  res.json({ history: all.slice(-limit) });
});

app.get('/api/settings', (_req: Request, res: Response) => {
  res.json({ ...currentSettings });
});

app.put('/api/settings', (req: Request, res: Response) => {
  const candidate = req.body;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    res.status(400).json({ error: 'Niepoprawne ustawienia' });
    return;
  }
  const body = candidate as Record<string, unknown>;
  const next: Settings = { ...currentSettings };

  if (body.ui_refresh_seconds === 20) {
    next.ui_refresh_seconds = 20;
  }
  if (body.theme === 'dark' || body.theme === 'light') {
    next.theme = body.theme;
  }
  if (
    body.default_sort === 'remaining' ||
    body.default_sort === 'clock' ||
    body.default_sort === 'name' ||
    body.default_sort === 'score'
  ) {
    next.default_sort = body.default_sort;
  }
  if (typeof body.compact_mode === 'boolean') {
    next.compact_mode = body.compact_mode;
  }
  if (typeof body.show_paused === 'boolean') {
    next.show_paused = body.show_paused;
  }
  if (typeof body.highlight_row_tint === 'boolean') {
    next.highlight_row_tint = body.highlight_row_tint;
  }
  if (typeof body.highlight_enabled === 'boolean') {
    next.highlight_enabled = body.highlight_enabled;
  }
  if (
    typeof body.highlight_goal_difference === 'number' &&
    Number.isInteger(body.highlight_goal_difference) &&
    body.highlight_goal_difference >= 1 &&
    body.highlight_goal_difference <= 10
  ) {
    next.highlight_goal_difference = body.highlight_goal_difference;
  }
  if (
    typeof body.highlight_remaining_seconds === 'number' &&
    Number.isInteger(body.highlight_remaining_seconds) &&
    body.highlight_remaining_seconds >= 15 &&
    body.highlight_remaining_seconds <= 600
  ) {
    next.highlight_remaining_seconds = body.highlight_remaining_seconds;
  }
  const hexColorRe = /^#[0-9a-fA-F]{6}$/;
  if (typeof body.highlight_color === 'string' && hexColorRe.test(body.highlight_color)) {
    next.highlight_color = body.highlight_color.toLowerCase();
  }
  if (typeof body.potential_enabled === 'boolean') {
    next.potential_enabled = body.potential_enabled;
  }
  if (
    typeof body.potential_goal_difference === 'number' &&
    Number.isInteger(body.potential_goal_difference) &&
    body.potential_goal_difference >= 1 &&
    body.potential_goal_difference <= 9
  ) {
    next.potential_goal_difference = body.potential_goal_difference;
  }
  if (
    typeof body.potential_remaining_seconds === 'number' &&
    Number.isInteger(body.potential_remaining_seconds) &&
    body.potential_remaining_seconds >= 30 &&
    body.potential_remaining_seconds <= 1200
  ) {
    next.potential_remaining_seconds = body.potential_remaining_seconds;
  }
  if (
    typeof body.potential_min_total_goals === 'number' &&
    Number.isInteger(body.potential_min_total_goals) &&
    body.potential_min_total_goals >= 0 &&
    body.potential_min_total_goals <= 20
  ) {
    next.potential_min_total_goals = body.potential_min_total_goals;
  }
  if (typeof body.potential_color === 'string' && hexColorRe.test(body.potential_color)) {
    next.potential_color = body.potential_color.toLowerCase();
  }
  if (typeof body.high_scoring_enabled === 'boolean') {
    next.high_scoring_enabled = body.high_scoring_enabled;
  }
  if (
    typeof body.high_scoring_min_goals === 'number' &&
    Number.isInteger(body.high_scoring_min_goals) &&
    body.high_scoring_min_goals >= 2 &&
    body.high_scoring_min_goals <= 20
  ) {
    next.high_scoring_min_goals = body.high_scoring_min_goals;
  }
  if (typeof body.high_scoring_color === 'string' && hexColorRe.test(body.high_scoring_color)) {
    next.high_scoring_color = body.high_scoring_color.toLowerCase();
  }
  if (typeof body.close_finish_enabled === 'boolean') {
    next.close_finish_enabled = body.close_finish_enabled;
  }
  if (
    typeof body.close_finish_remaining_seconds === 'number' &&
    Number.isInteger(body.close_finish_remaining_seconds) &&
    body.close_finish_remaining_seconds >= 15 &&
    body.close_finish_remaining_seconds <= 600
  ) {
    next.close_finish_remaining_seconds = body.close_finish_remaining_seconds;
  }
  if (typeof body.close_finish_color === 'string' && hexColorRe.test(body.close_finish_color)) {
    next.close_finish_color = body.close_finish_color.toLowerCase();
  }
  if (typeof body.notify_enabled === 'boolean') {
    next.notify_enabled = body.notify_enabled;
  }
  if (typeof body.notify_potential === 'boolean') {
    next.notify_potential = body.notify_potential;
  }
  if (typeof body.notify_primary === 'boolean') {
    next.notify_primary = body.notify_primary;
  }
  if (typeof body.notify_high_scoring === 'boolean') {
    next.notify_high_scoring = body.notify_high_scoring;
  }
  if (typeof body.notify_close_finish === 'boolean') {
    next.notify_close_finish = body.notify_close_finish;
  }
  if (typeof body.notify_sound === 'boolean') {
    next.notify_sound = body.notify_sound;
  }
  if (
    typeof body.notify_cooldown_seconds === 'number' &&
    Number.isInteger(body.notify_cooldown_seconds) &&
    body.notify_cooldown_seconds >= 0 &&
    body.notify_cooldown_seconds <= 3600
  ) {
    next.notify_cooldown_seconds = body.notify_cooldown_seconds;
  }

  currentSettings = next;
  res.json({ ...currentSettings });
});

app.get('/api/export.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Disposition', 'attachment; filename="live-matches.json"');
  res.json(livePayload());
});

app.get('/api/export.csv', (_req: Request, res: Response) => {
  const matches = livePayload().matches;
  const fields: Array<keyof NormalizedMatch> = [
    'competition',
    'home',
    'away',
    'home_score',
    'away_score',
    'half',
    'clock_label',
    'format_minutes',
    'added_time_seconds',
    'break_seconds',
    'started_at',
    'estimated_end_at',
    'status',
    'observed_at',
  ];
  const lines = [
    fields.join(','),
    ...matches.map((match) => fields.map((field) => csvCell(match[field])).join(',')),
  ];
  const csvBody = `\uFEFF${lines.join('\r\n')}\r\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="live-matches.csv"');
  res.send(csvBody);
});

app.post('/snapshot', (req: Request, res: Response) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.matches)) {
    res.status(400).json({ error: 'Niepoprawna migawka' });
    return;
  }
  if (isDemoMode) {
    clearMatchesState();
  }
  if (typeof payload.superbetTime === 'string' && !Number.isNaN(Date.parse(payload.superbetTime))) {
    superbetTimeOffsetMs = Date.parse(payload.superbetTime) - Date.now();
  } else if (typeof payload.superbetTime === 'number' && Number.isFinite(payload.superbetTime)) {
    superbetTimeOffsetMs = payload.superbetTime - Date.now();
  }
  lastSuperbetTimeLabel =
    typeof payload.superbetClockText === 'string' && payload.superbetClockText.trim()
      ? payload.superbetClockText.trim()
      : null;
  const accepted = ingestMatches(payload.matches);
  res.status(202).json({ accepted });
});

app.post('/api/demo/load', (_req: Request, res: Response) => {
  const accepted = seedDemoMatches();
  res.json({ accepted, ...livePayload() });
});

app.post('/api/demo/clear', (_req: Request, res: Response) => {
  clearMatchesState();
  res.json(livePayload());
});

app.use(express.static(WEB_DIR));

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

seedDemoMatches();

app.listen(PORT, HOST, () => {
  console.log(`Live FIFA Analyzer działa pod http://${HOST}:${PORT}`);
});
