const DEFAULT_SETTINGS = {
  ui_refresh_seconds: 20,
  theme: 'dark',
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

const state = {
  matches: [],
  selected: null,
  isDemo: false,
  fetchedAtMs: Date.now(),
  nextRefreshAtMs: Date.now() + 20_000,
  superbetOffsetMs: 0,
  superbetTimeLabel: null,
  sourceAgeBase: null,
  sourceOnline: false,
  sourceStatus: 'waiting',
  settings: { ...DEFAULT_SETTINGS },
  view: 'table',
  swRegistration: null,
  bgWorker: null,
  audioCtx: null,
  notifiedMap: new Map(),
  notifyHistory: [],
  notifyTotalSent: 0,
  notifyCollapsed: false,
};

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

const normalizeHex = (color, fallback = '#dc2626') => (/^#[0-9a-fA-F]{6}$/.test(String(color || '').trim()) ? String(color).trim().toLowerCase() : fallback);

function hexToRgba(hex, alpha) {
  const clean = normalizeHex(hex).slice(1);
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function highlightStyleAttr(hex) {
  const base = normalizeHex(hex);
  return `--hl-color:${base};--hl-border:${hexToRgba(base, 0.78)};--hl-soft:${hexToRgba(base, 0.24)};--hl-row:${hexToRgba(base, 0.13)};--hl-row-hover:${hexToRgba(base, 0.21)};`;
}

const remaining = (match) => {
  if (match.remaining_seconds != null) {
    const n = Math.max(0, Number(match.remaining_seconds));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  }
  return 'szacunek';
};

const format = (match) => (match.format_minutes ? `2 × ${Number(match.format_minutes) / 2} min` : 'brak');
const score = (match) => match.score_label || `${match.home_score ?? '–'}:${match.away_score ?? '–'}`;
const matchName = (match) => `${match.home || ''} — ${match.away || ''}`;

const formatTimeShort = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatExtraSummary = (match) => {
  const parts = [];
  if (Number(match.added_time_seconds) > 0) parts.push(`+${Number(match.added_time_seconds)}s dol.`);
  if (Number(match.break_seconds) > 0) parts.push(`przerwa ${Number(match.break_seconds)}s`);
  return parts.join(' · ');
};

function formatClockLabel(half, clockSec, formatMinutes) {
  const mm = String(Math.floor(clockSec / 60)).padStart(2, '0');
  const ss = String(clockSec % 60).padStart(2, '0');
  if (formatMinutes != null && Number(formatMinutes) > 0 && Number(formatMinutes) % 2 === 0) {
    const halfSeconds = (Number(formatMinutes) / 2) * 60;
    const totalMatchSec = (Number(half) - 1) * halfSeconds + clockSec;
    const matchMinute = Math.max(1, Math.ceil(totalMatchSec / 60));
    return `${matchMinute}' (${mm}:${ss})`;
  }
  return `${mm}:${ss}`;
}

function liveMatch(match, deltaSec) {
  if (!deltaSec || deltaSec <= 0) return match;
  const totalMinutes = match.format_minutes != null ? Number(match.format_minutes) : null;
  const half = Number(match.half);
  const clockSec = Number(match.clock_seconds);
  const addedSec = Math.max(0, Number(match.added_time_seconds) || 0);
  const breakSec = Math.max(0, Number(match.break_seconds) || 0);
  if (totalMinutes && totalMinutes > 0 && totalMinutes % 2 === 0 && (half === 1 || half === 2) && Number.isFinite(clockSec)) {
    const halfSeconds = (totalMinutes / 2) * 60;
    const totalRegular = totalMinutes * 60;
    const totalCycle = totalRegular + breakSec + addedSec;
    const baseElapsedFromStart =
      match.remaining_seconds != null
        ? Math.max(0, totalCycle - Number(match.remaining_seconds))
        : (half - 1) * halfSeconds + Math.min(clockSec, halfSeconds) + (half === 2 ? breakSec : 0);

    let pos = baseElapsedFromStart + deltaSec;
    if (state.isDemo) {
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
    const nowMs = Date.now();
    const startedAt = new Date(nowMs - pos * 1000).toISOString();
    const estimatedEndAt = new Date(nowMs + projectedRemaining * 1000).toISOString();
    const extraSec = inAdded ? Math.max(0, pos - (totalRegular + breakSec)) : 0;
    const baseClockLabel = formatClockLabel(projectedHalf, projectedClock, totalMinutes);
    const clockLabel = inBreak ? `Przerwa (${pos - halfSeconds}s / ${breakSec}s)` : inAdded ? `${baseClockLabel} +${extraSec}s` : baseClockLabel;

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
  if (Number.isFinite(clockSec)) {
    const projectedClock = clockSec + deltaSec;
    return {
      ...match,
      clock_seconds: projectedClock,
      clock_label: formatClockLabel(half, projectedClock, null),
    };
  }
  return match;
}

function currentLiveMatches() {
  const deltaSec = Math.max(0, Math.floor((Date.now() - state.fetchedAtMs) / 1000));
  return state.matches.map((m) => liveMatch(m, deltaSec));
}

function computePrediction(match) {
  const home = Number(match.home_score);
  const away = Number(match.away_score);
  if (!Number.isInteger(home) || !Number.isInteger(away)) {
    return {
      valid: false,
      totalGoals: 0,
      diff: 0,
      leaderSide: null,
      elapsedSeconds: 0,
      goalRatePerMin: 0,
      projectedTotalGoals: 0,
      projectedFinalDiff: 0,
      outlook: 'Brak potwierdzonego wyniku bramkowego do wyliczenia prognozy.',
      momentumNote: 'Oczekiwanie na pełne dane wyniku.',
    };
  }

  const totalGoals = home + away;
  const diff = Math.abs(home - away);
  const leaderSide = home > away ? 'home' : away > home ? 'away' : null;
  const totalMinutes = match.format_minutes != null ? Number(match.format_minutes) : null;
  const half = Number(match.half);
  const clockSec = Math.max(0, Number(match.clock_seconds) || 0);

  let elapsedSeconds = Math.max(30, clockSec);
  if (totalMinutes && totalMinutes > 0 && totalMinutes % 2 === 0 && (half === 1 || half === 2)) {
    const halfSec = (totalMinutes / 2) * 60;
    elapsedSeconds = Math.max(30, (half === 2 ? halfSec : 0) + Math.min(clockSec, halfSec));
  }

  const elapsedMinutes = elapsedSeconds / 60;
  const goalRatePerMin = totalGoals / elapsedMinutes;
  const remSeconds = match.remaining_seconds != null ? Math.max(0, Number(match.remaining_seconds)) : 0;
  const remMinutes = remSeconds / 60;
  const projectedExtraGoals = goalRatePerMin * remMinutes;
  const projectedTotalGoals = Number((totalGoals + projectedExtraGoals).toFixed(1));

  const leaderGoals = leaderSide === 'home' ? home : leaderSide === 'away' ? away : totalGoals / 2;
  const leaderShare = totalGoals > 0 ? leaderGoals / totalGoals : 0.5;
  const momentumBoost =
    leaderSide && match.last_scorer_side
      ? match.last_scorer_side === leaderSide
        ? 0.35
        : -0.25
      : 0;
  const projectedFinalDiff = Math.max(
    0,
    Number((diff + (2 * leaderShare - 1) * projectedExtraGoals + momentumBoost).toFixed(1)),
  );

  const s = state.settings;
  const primaryDiff = Math.max(1, Number(s.highlight_goal_difference) || 3);
  const potentialDiff = Math.max(1, Number(s.potential_goal_difference) || 2);
  let outlook = `Tempo strzeleckie wynosi ${goalRatePerMin.toFixed(2)} gola/min (szacowana suma: ~${projectedTotalGoals} goli).`;

  if (diff >= primaryDiff) {
    outlook = `Lider utrzymuje przewagę ${diff} goli. Prognozowana różnica końcowa: ~${projectedFinalDiff} gola.`;
  } else if (diff >= potentialDiff && diff < primaryDiff) {
    const leaderTeam = leaderSide === 'home' ? match.home : match.away;
    const hitChance = projectedFinalDiff >= primaryDiff - 0.25 || match.last_scorer_side === leaderSide ? 'wysoka' : 'umiarkowana';
    outlook = `Mecz zanosi się na ${primaryDiff}+ goli przewagi (${leaderTeam} prowadzi ${diff} bramkami, szansa ${hitChance}). Prognoza różnicy na koniec: ~${projectedFinalDiff}.`;
  } else if (totalGoals >= (Number(s.high_scoring_min_goals) || 5)) {
    outlook = `Bardzo wysokie tempo ofensywne (${totalGoals} bramek · ${goalRatePerMin.toFixed(2)} gola/min). Oczekiwana suma końcowa: ~${projectedTotalGoals}.`;
  } else if (diff <= 1 && match.remaining_seconds != null && remSeconds <= (Number(s.close_finish_remaining_seconds) || 120)) {
    outlook = `Końcówka na styku (${diff === 0 ? 'remis' : '1 gol różnicy'}). Każda kolejna bramka odwraca wynik.`;
  }

  const lastTeam =
    match.last_scorer_side === 'home'
      ? match.home
      : match.last_scorer_side === 'away'
        ? match.away
        : null;
  const momentumParts = [
    `Tempo: ${goalRatePerMin.toFixed(2)} gola/min`,
    `Prognoza sumy: ~${projectedTotalGoals}`,
    `Prognoza przewagi: ~${projectedFinalDiff}`,
  ];
  if (lastTeam) {
    momentumParts.push(`Ostatni gol (momentum): ${lastTeam}`);
  }

  return {
    valid: true,
    totalGoals,
    diff,
    leaderSide,
    elapsedSeconds,
    goalRatePerMin,
    projectedTotalGoals,
    projectedFinalDiff,
    outlook,
    momentumNote: momentumParts.join(' · '),
  };
}

function evaluateHighlights(match) {
  const s = state.settings;
  const pred = computePrediction(match);
  const rem = match.remaining_seconds != null ? Number(match.remaining_seconds) : null;
  const tags = [];

  if (
    s.highlight_enabled &&
    pred.valid &&
    rem != null &&
    rem >= 0 &&
    rem <= Number(s.highlight_remaining_seconds) &&
    pred.diff >= Number(s.highlight_goal_difference)
  ) {
    tags.push({
      type: 'primary',
      color: normalizeHex(s.highlight_color, '#dc2626'),
      side: pred.leaderSide,
      label: `PRZEWAGA ${pred.diff}+ · KONIEC ≤ ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`,
    });
  }

  const primaryMinDiff = s.highlight_enabled ? Number(s.highlight_goal_difference) || 3 : 99;
  const potentialDiff = Math.max(1, Number(s.potential_goal_difference) || 2);
  if (
    s.potential_enabled &&
    pred.valid &&
    pred.diff >= potentialDiff &&
    pred.diff < primaryMinDiff &&
    (rem == null || (rem >= 0 && rem <= Number(s.potential_remaining_seconds))) &&
    pred.totalGoals >= Number(s.potential_min_total_goals ?? 0)
  ) {
    const momentumSuffix = pred.leaderSide && match.last_scorer_side === pred.leaderSide ? ' · ↑ GOL LIDERA' : '';
    tags.push({
      type: 'potential',
      color: normalizeHex(s.potential_color, '#f59e0b'),
      side: pred.leaderSide,
      label: `ZANOSI SIĘ NA ${Number(s.highlight_goal_difference) || 3}+ (${pred.diff} GOLE · ${pred.goalRatePerMin.toFixed(1)}/MIN${momentumSuffix})`,
    });
  }

  if (s.high_scoring_enabled && pred.valid && pred.totalGoals >= Number(s.high_scoring_min_goals || 5)) {
    tags.push({
      type: 'high_scoring',
      color: normalizeHex(s.high_scoring_color, '#8b5cf6'),
      side: pred.leaderSide,
      label: `TEMPO ${pred.totalGoals} GOLI · ${pred.goalRatePerMin.toFixed(1)}/MIN`,
    });
  }

  if (
    s.close_finish_enabled &&
    pred.valid &&
    pred.diff <= 1 &&
    rem != null &&
    rem >= 0 &&
    rem <= Number(s.close_finish_remaining_seconds || 120)
  ) {
    tags.push({
      type: 'close_finish',
      color: normalizeHex(s.close_finish_color, '#0ea5e9'),
      side: null,
      label: `NA STYKU (${pred.diff === 0 ? 'REMIS' : '1 GOL'} · ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')})`,
    });
  }

  return { tags, types: tags.map((t) => t.type), pred };
}

function highlightInfo(match) {
  const evaluation = evaluateHighlights(match);
  if (!evaluation.tags.length) return null;
  const activeFilter = $('highlightFilter')?.value || 'all';
  const preferred =
    activeFilter !== 'all' && activeFilter !== 'any'
      ? evaluation.tags.find((t) => t.type === activeFilter) || evaluation.tags[0]
      : evaluation.tags[0];
  return { ...preferred, tags: evaluation.tags, types: evaluation.types, pred: evaluation.pred };
}

function teamNamesHtml(match, info = highlightInfo(match)) {
  const homeClass = info?.side === 'home' ? 'team-name team-leading-highlight' : 'team-name';
  const awayClass = info?.side === 'away' ? 'team-name team-leading-highlight' : 'team-name';
  const teamStyle = info?.side ? ` style="${highlightStyleAttr(info.color)}"` : '';
  const badges = info
    ? info.tags
        .slice(0, 2)
        .map((tag) => `<span class="lead-alert" style="${highlightStyleAttr(tag.color)}">${esc(tag.label)}</span>`)
        .join(' ')
    : '';
  return `<span class="${homeClass}"${info?.side === 'home' ? teamStyle : ''}>${esc(match.home || '')}</span><span class="team-separator"> — </span><span class="${awayClass}"${info?.side === 'away' ? teamStyle : ''}>${esc(match.away || '')}</span>${badges ? `<div>${badges}</div>` : ''}`;
}

function filteredMatches(liveList) {
  const query = $('searchInput').value.trim().toLowerCase();
  const half = $('halfFilter').value;
  const status = $('statusFilter').value;
  const hlFilter = $('highlightFilter').value;
  const list = liveList.filter((m) => {
    const haystack = `${m.home} ${m.away} ${m.competition}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (half !== 'all' && String(m.half) !== half) return false;
    if (status !== 'all' && m.status !== status) return false;
    if (m.is_live === false) return false;
    if (hlFilter !== 'all') {
      const { types } = evaluateHighlights(m);
      if (hlFilter === 'any' && types.length === 0) return false;
      if (hlFilter !== 'any' && !types.includes(hlFilter)) return false;
    }
    return true;
  });
  list.sort((a, b) => {
    const ar = a.remaining_seconds == null ? Number.POSITIVE_INFINITY : Number(a.remaining_seconds);
    const br = b.remaining_seconds == null ? Number.POSITIVE_INFINITY : Number(b.remaining_seconds);
    if (ar !== br) return ar - br;
    return matchName(a).localeCompare(matchName(b), 'pl') || String(a.key).localeCompare(String(b.key));
  });
  return list;
}

function statusHtml(match) {
  const paused = match.status !== 'aktywny';
  return `<span class="status-dot ${paused ? 'status-paused' : ''}">${esc(match.status || 'brak')}</span>`;
}

function renderLegend(liveList) {
  const legendEl = $('highlightLegend');
  if (!legendEl) return;
  const s = state.settings;
  const activeFilter = $('highlightFilter').value;
  const rules = [
    { id: 'primary', enabled: s.highlight_enabled, label: `Przewaga ${s.highlight_goal_difference}+`, color: normalizeHex(s.highlight_color, '#dc2626') },
    { id: 'potential', enabled: s.potential_enabled, label: `Zanosi się (${s.potential_goal_difference} gole)`, color: normalizeHex(s.potential_color, '#f59e0b') },
    { id: 'high_scoring', enabled: s.high_scoring_enabled, label: `Tempo ${s.high_scoring_min_goals}+ goli`, color: normalizeHex(s.high_scoring_color, '#8b5cf6') },
    { id: 'close_finish', enabled: s.close_finish_enabled, label: 'Końcówka na styku', color: normalizeHex(s.close_finish_color, '#0ea5e9') },
  ].filter((r) => r.enabled);

  if (!rules.length) {
    legendEl.innerHTML = '<span class="muted">Wszystkie reguły podświetleń są wyłączone w ustawieniach.</span>';
    return;
  }

  const counts = {};
  for (const r of rules) counts[r.id] = 0;
  for (const m of liveList) {
    const { types } = evaluateHighlights(m);
    for (const type of types) {
      if (counts[type] !== undefined) counts[type] += 1;
    }
  }

  const buttons = rules.map(
    (r) =>
      `<button type="button" class="legend-btn ${activeFilter === r.id ? 'active' : ''}" data-hl="${r.id}"><span class="legend-swatch" style="background:${esc(r.color)}"></span><span>${esc(r.label)} (${counts[r.id]})</span></button>`,
  );
  if (activeFilter !== 'all') {
    buttons.unshift(`<button type="button" class="legend-btn" data-hl="all">Wszystkie (${liveList.length})</button>`);
  }
  legendEl.innerHTML = buttons.join('');
  legendEl.querySelectorAll('.legend-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.hl;
      $('highlightFilter').value = activeFilter === target && target !== 'all' ? 'all' : target;
      render();
    });
  });
}

function updateHeroClocks() {
  const nowMs = Date.now();
  const currentEl = $('currentClock');
  if (currentEl) {
    currentEl.textContent = new Date(nowMs).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  const superbetEl = $('superbetClock');
  if (superbetEl) {
    if (state.superbetTimeLabel) {
      superbetEl.textContent = `${state.superbetTimeLabel} (Superbet)`;
    } else {
      const sbStr = new Date(nowMs + state.superbetOffsetMs).toLocaleTimeString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const suffix = state.isDemo ? 'Warszawa · DEMO' : state.sourceOnline ? 'Warszawa · LIVE' : 'Warszawa';
      superbetEl.textContent = `${sbStr} (${suffix})`;
    }
  }
  const countdownEl = $('nextRefreshCountdown');
  if (countdownEl) {
    const secLeft = Math.max(0, Math.ceil((state.nextRefreshAtMs - nowMs) / 1000));
    countdownEl.textContent = `${secLeft} s`;
  }
}

function render() {
  updateHeroClocks();
  const liveList = currentLiveMatches();
  renderLegend(liveList);
  checkAndDispatchAlerts(liveList);
  const list = filteredMatches(liveList);
  $('resultCount').textContent = `${list.length} wyników`;
  $('totalMatches').textContent = liveList.length;
  $('secondHalf').textContent = liveList.filter((m) => Number(m.half) === 2).length;
  const next = [...liveList].sort((a, b) => (a.remaining_seconds ?? 999999) - (b.remaining_seconds ?? 999999))[0];
  $('nextMatch').textContent = next ? remaining(next) : '—';
  $('nextMatchNote').textContent = next ? `${matchName(next)}${next.estimated_end_at ? ` · koniec ~${formatTimeShort(next.estimated_end_at)}` : ''}` : 'brak danych';
  if (state.sourceAgeBase != null) {
    const deltaSec = Math.max(0, Math.floor((Date.now() - state.fetchedAtMs) / 1000));
    const ageNow = state.isDemo ? (state.sourceAgeBase + deltaSec) % 20 : state.sourceAgeBase + deltaSec;
    $('sourceAge').textContent = `${ageNow}s`;
  }

  const rowTint = Boolean(state.settings.highlight_row_tint);
  const body = $('matchesBody');
  body.innerHTML = list
    .map((m) => {
      const info = highlightInfo(m);
      const extra = formatExtraSummary(m);
      const startStr = formatTimeShort(m.started_at);
      const endStr = m.estimated_end_at ? `~${formatTimeShort(m.estimated_end_at)}` : 'nieznany';
      const rowClasses = [state.selected?.key === m.key ? 'selected' : '', info && rowTint ? 'row-highlighted' : ''].filter(Boolean).join(' ');
      const rowStyle = info && rowTint ? ` style="${highlightStyleAttr(info.color)}"` : '';
      return `<tr data-key="${esc(m.key)}" class="${rowClasses}"${rowStyle}><td>${remaining(m)}${extra ? `<br><span class="extra-tag">${esc(extra)}</span>` : ''}</td><td class="team-cell">${teamNamesHtml(m, info)}<small>${esc(m.competition)}</small></td><td class="score">${esc(score(m))}</td><td>${esc(m.half_label || (m.half ? `${m.half}. połowa` : 'brak'))}<br><span class="muted">${esc(m.clock_label || 'brak')}</span></td><td>Start: ${esc(startStr)}<br><span class="muted">Koniec: ${esc(endStr)}</span></td><td>${statusHtml(m)}</td></tr>`;
    })
    .join('');
  body.querySelectorAll('tr').forEach((row) => row.addEventListener('click', () => selectMatch(row.dataset.key)));

  $('compactView').innerHTML = list
    .map((m) => {
      const info = highlightInfo(m);
      const extra = formatExtraSummary(m);
      const startStr = formatTimeShort(m.started_at);
      const endStr = m.estimated_end_at ? `~${formatTimeShort(m.estimated_end_at)}` : 'nieznany';
      const cardClasses = ['match-card', info && rowTint ? 'card-highlighted' : ''].filter(Boolean).join(' ');
      const cardStyle = info && rowTint ? ` style="${highlightStyleAttr(info.color)}"` : '';
      return `<article class="${cardClasses}" data-key="${esc(m.key)}"${cardStyle}><div class="card-top"><span>${esc(m.competition)}</span><span>${remaining(m)}</span></div><h3 class="card-teams">${teamNamesHtml(m, info)}</h3><span class="card-score">${esc(score(m))}</span><p class="muted">${esc(m.half_label || 'brak')} · ${esc(m.clock_label || 'brak')}</p><p class="muted">Start: ${esc(startStr)} · Koniec: ${esc(endStr)}</p>${extra ? `<p><span class="extra-tag">${esc(extra)}</span></p>` : ''}${statusHtml(m)}</article>`;
    })
    .join('');
  $('compactView').querySelectorAll('.match-card').forEach((card) => card.addEventListener('click', () => selectMatch(card.dataset.key)));

  $('emptyState').classList.toggle('hidden', list.length !== 0);
  $('tableView').classList.toggle('hidden', state.view !== 'table');
  $('compactView').classList.toggle('hidden', state.view !== 'compact');

  if (state.selected) {
    const refreshedSelected = liveList.find((m) => m.key === state.selected.key) || null;
    if (refreshedSelected) {
      state.selected = refreshedSelected;
      renderDetail(refreshedSelected);
    } else {
      state.selected = null;
      $('detailEmpty').classList.remove('hidden');
      $('detailContent').classList.add('hidden');
      $('detailLive').classList.add('hidden');
    }
  }
}

async function selectMatch(key) {
  state.selected = currentLiveMatches().find((m) => m.key === key) || null;
  render();
  if (!state.selected) return;
  try {
    const response = await fetch(`/api/history?match_key=${encodeURIComponent(key)}`);
    const data = await response.json();
    renderHistory(data.history || []);
  } catch (_) {
    renderHistory([]);
  }
}

function renderDetail(match) {
  const info = highlightInfo(match);
  const pred = info?.pred || computePrediction(match);
  $('detailEmpty').classList.add('hidden');
  $('detailContent').classList.remove('hidden');
  $('detailLive').classList.toggle('hidden', match.status !== 'aktywny');
  $('detailCompetition').textContent = match.competition || 'E-PIŁKA LIVE';
  $('detailTeams').innerHTML = teamNamesHtml(match, info);
  $('detailScore').textContent = score(match);
  $('detailHalf').textContent = match.half_label || (match.half ? `${match.half}. połowa` : 'brak');
  $('detailClock').textContent = match.clock_label || 'brak';
  $('detailFormat').textContent = format(match);
  $('detailRemaining').textContent = remaining(match);
  $('detailStartTime').textContent = formatTimeShort(match.started_at);
  $('detailEndTime').textContent = match.estimated_end_at ? `~${formatTimeShort(match.estimated_end_at)}` : 'brak (format nieznany)';
  $('detailAddedTime').textContent = Number(match.added_time_seconds) > 0 ? `+${Number(match.added_time_seconds)} s` : 'brak';
  $('detailBreakTime').textContent = Number(match.break_seconds) > 0 ? `${Number(match.break_seconds)} s` : 'brak';
  $('detailAnalysis').textContent = match.analysis || `Mecz ${match.status || 'live'}, ${match.half_label || 'faza nieznana'}, czas ${match.clock_label || 'brak'}. Dane pochodzą z ostatniej migawki strony.`;
  $('detailExtraNote').textContent = match.added_time_note || 'Brak doliczonego czasu i przerw';
  $('detailPrediction').textContent = pred.outlook;
  $('detailPredictionMeta').textContent = pred.momentumNote;
}

function renderHistory(history) {
  $('historyList').innerHTML = history.length
    ? history
        .slice(0, 8)
        .map((row) => `<div class="history-row"><span>${esc(new Date(row.observed_at).toLocaleTimeString())}</span><strong>${esc(row.score || row.score_label || 'brak')} · ${esc(row.clock_label || '')}</strong></div>`)
        .join('')
    : '<p class="muted">Brak wcześniejszych odczytów.</p>';
}

async function loadLive() {
  try {
    const response = await fetch('/api/live', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP');
    const data = await response.json();
    const nowMs = Date.now();
    state.isDemo = Boolean(data.is_demo);
    state.fetchedAtMs = nowMs;
    state.nextRefreshAtMs = nowMs + 20_000;
    state.superbetOffsetMs = data.superbet_time && !Number.isNaN(Date.parse(data.superbet_time)) ? Date.parse(data.superbet_time) - nowMs : 0;
    state.superbetTimeLabel = data.superbet_time_label || null;
    state.sourceAgeBase = data.source_age_seconds != null ? Number(data.source_age_seconds) : null;
    state.sourceOnline = Boolean(data.source_online);
    state.sourceStatus = data.source_status || 'waiting';
    state.matches = (data.matches || []).map((m) => ({
      ...m,
      score_label: score(m),
      half_label: m.half_label || (m.half ? `${m.half}. połowa` : 'brak'),
    }));
    $('connectionBadge').textContent = data.is_demo ? 'Dane testowe (DEMO)' : data.source_online ? 'Źródło aktualne' : 'Brak aktualnych danych';
    $('connectionBadge').className = data.is_demo ? 'badge badge-warn' : data.source_online ? 'badge badge-ok' : 'badge badge-warn';
    $('demoBtn').textContent = data.is_demo ? 'Wyczyść testowe' : 'Załaduj testowe';
    $('sourceAge').textContent = data.source_age_seconds != null ? `${data.source_age_seconds}s` : '—';
    $('sourceNote').textContent = data.is_demo ? 'tryb demonstracyjny (DEMO)' : data.source_online ? 'ostatni sygnał Chrome' : data.source_status === 'stale' ? 'sygnał jest nieaktualny' : 'oczekiwanie na Chrome';
    $('lastUpdate').textContent = `Ostatni odczyt panelu: ${new Date(nowMs).toLocaleTimeString('pl-PL')}`;
    render();
  } catch (_) {
    $('connectionBadge').textContent = 'Brak połączenia';
    $('connectionBadge').className = 'badge badge-warn';
    $('sourceNote').textContent = 'uruchom serwer';
  }
}

async function toggleDemo() {
  try {
    const endpoint = state.isDemo ? '/api/demo/clear' : '/api/demo/load';
    const response = await fetch(endpoint, { method: 'POST' });
    if (response.ok) {
      state.selected = null;
      await loadLive();
      startPolling();
    }
  } catch (_) {}
}

function applySettingsToForm(s) {
  $('uiRefresh').value = '20';
  $('themeSelect').value = s.theme || 'dark';
  $('highlightRowTint').checked = Boolean(s.highlight_row_tint);
  $('highlightEnabled').checked = Boolean(s.highlight_enabled);
  $('highlightGoalDifference').value = String(s.highlight_goal_difference ?? 3);
  $('highlightRemainingSeconds').value = String(s.highlight_remaining_seconds ?? 90);
  $('highlightColor').value = normalizeHex(s.highlight_color, '#dc2626');
  $('potentialEnabled').checked = Boolean(s.potential_enabled);
  $('potentialGoalDifference').value = String(s.potential_goal_difference ?? 2);
  $('potentialRemainingSeconds').value = String(s.potential_remaining_seconds ?? 300);
  $('potentialMinTotalGoals').value = String(s.potential_min_total_goals ?? 2);
  $('potentialColor').value = normalizeHex(s.potential_color, '#f59e0b');
  $('highScoringEnabled').checked = Boolean(s.high_scoring_enabled);
  $('highScoringMinGoals').value = String(s.high_scoring_min_goals ?? 5);
  $('highScoringColor').value = normalizeHex(s.high_scoring_color, '#8b5cf6');
  $('closeFinishEnabled').checked = Boolean(s.close_finish_enabled);
  $('closeFinishRemainingSeconds').value = String(s.close_finish_remaining_seconds ?? 120);
  $('closeFinishColor').value = normalizeHex(s.close_finish_color, '#0ea5e9');
  syncNotifyControlsFromSettings(s);
}

function readNotifyFromPanel() {
  return {
    notify_enabled: $('notifyEnabled').checked,
    notify_potential: $('notifyPotential').checked,
    notify_primary: $('notifyPrimary').checked,
    notify_high_scoring: $('notifyHighScoring').checked,
    notify_close_finish: $('notifyCloseFinish').checked,
    notify_sound: $('notifySound').checked,
    notify_cooldown_seconds: Math.max(0, Math.min(3600, Math.trunc(Number($('notifyCooldown').value) || 0))),
  };
}

function readSettingsFromForm() {
  return {
    ui_refresh_seconds: 20,
    theme: $('themeSelect').value === 'light' ? 'light' : 'dark',
    show_paused: true,
    highlight_row_tint: $('highlightRowTint').checked,
    highlight_enabled: $('highlightEnabled').checked,
    highlight_goal_difference: Math.max(1, Math.min(10, Math.trunc(Number($('highlightGoalDifference').value) || 3))),
    highlight_remaining_seconds: Math.max(15, Math.min(600, Math.trunc(Number($('highlightRemainingSeconds').value) || 90))),
    highlight_color: normalizeHex($('highlightColor').value, '#dc2626'),
    potential_enabled: $('potentialEnabled').checked,
    potential_goal_difference: Math.max(1, Math.min(9, Math.trunc(Number($('potentialGoalDifference').value) || 2))),
    potential_remaining_seconds: Math.max(30, Math.min(1200, Math.trunc(Number($('potentialRemainingSeconds').value) || 300))),
    potential_min_total_goals: Math.max(0, Math.min(20, Math.trunc(Number($('potentialMinTotalGoals').value) ?? 2))),
    potential_color: normalizeHex($('potentialColor').value, '#f59e0b'),
    high_scoring_enabled: $('highScoringEnabled').checked,
    high_scoring_min_goals: Math.max(2, Math.min(20, Math.trunc(Number($('highScoringMinGoals').value) || 5))),
    high_scoring_color: normalizeHex($('highScoringColor').value, '#8b5cf6'),
    close_finish_enabled: $('closeFinishEnabled').checked,
    close_finish_remaining_seconds: Math.max(15, Math.min(600, Math.trunc(Number($('closeFinishRemainingSeconds').value) || 120))),
    close_finish_color: normalizeHex($('closeFinishColor').value, '#0ea5e9'),
    ...readNotifyFromPanel(),
  };
}

function syncNotifyControlsFromSettings(s) {
  $('notifyEnabled').checked = Boolean(s.notify_enabled);
  $('notifyPotential').checked = Boolean(s.notify_potential);
  $('notifyPrimary').checked = Boolean(s.notify_primary);
  $('notifyHighScoring').checked = Boolean(s.notify_high_scoring);
  $('notifyCloseFinish').checked = Boolean(s.notify_close_finish);
  $('notifySound').checked = Boolean(s.notify_sound);
  $('notifyCooldown').value = String(s.notify_cooldown_seconds ?? 120);
  const potentialSw = $('notifyPotentialSwatch');
  const primarySw = $('notifyPrimarySwatch');
  const highSw = $('notifyHighScoringSwatch');
  const closeSw = $('notifyCloseFinishSwatch');
  if (potentialSw) potentialSw.style.background = normalizeHex(s.potential_color, '#f59e0b');
  if (primarySw) primarySw.style.background = normalizeHex(s.highlight_color, '#dc2626');
  if (highSw) highSw.style.background = normalizeHex(s.high_scoring_color, '#8b5cf6');
  if (closeSw) closeSw.style.background = normalizeHex(s.close_finish_color, '#0ea5e9');
  updateNotifyStatusUI();
}

function updateNotifyStatusUI() {
  const badge = $('notifyPermBadge');
  const reqBtn = $('requestNotifyBtn');
  const topDot = $('notifyTopDot');
  const topLabel = $('notifyTopLabel');
  const summaryEl = $('notifyCountSummary');
  const enabled = Boolean(state.settings.notify_enabled);
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const perm = supported ? Notification.permission : 'unsupported';

  if (summaryEl) summaryEl.textContent = `Wysłano alertów: ${state.notifyTotalSent}`;

  if (!enabled) {
    badge.textContent = 'Alerty wyłączone';
    badge.className = 'badge badge-warn';
    reqBtn.classList.toggle('hidden', perm === 'granted');
    topDot.className = 'notify-dot off';
    topLabel.textContent = 'Alerty: Wył.';
    return;
  }

  if (!supported) {
    badge.textContent = 'Tryb wewnątrz strony (brak Notification API)';
    badge.className = 'badge badge-warn';
    reqBtn.classList.add('hidden');
    topDot.className = 'notify-dot';
    topLabel.textContent = `Alerty (${state.notifyTotalSent})`;
    return;
  }

  if (perm === 'granted') {
    badge.textContent = 'Zgoda aktywna (przeglądarka)';
    badge.className = 'badge badge-ok';
    reqBtn.classList.add('hidden');
    topDot.className = 'notify-dot active';
    topLabel.textContent = state.notifyTotalSent > 0 ? `Alerty: Wł. (${state.notifyTotalSent})` : 'Alerty: Wł.';
  } else if (perm === 'denied') {
    badge.textContent = 'Zablokowane w przeglądarce (aktywne w panelu)';
    badge.className = 'badge badge-warn';
    reqBtn.classList.add('hidden');
    topDot.className = 'notify-dot';
    topLabel.textContent = 'Alerty: Zablok.';
  } else {
    badge.textContent = 'Wymagana zgoda przeglądarki';
    badge.className = 'badge badge-warn';
    reqBtn.classList.remove('hidden');
    topDot.className = 'notify-dot';
    topLabel.textContent = 'Włącz alerty';
  }
}

async function saveNotifySettings() {
  const partial = readNotifyFromPanel();
  state.settings = { ...state.settings, ...partial };
  updateNotifyStatusUI();
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.settings),
    });
    if (response.ok) {
      state.settings = { ...DEFAULT_SETTINGS, ...(await response.json()) };
      syncNotifyControlsFromSettings(state.settings);
    }
  } catch (err) {
    console.error('Błąd zapisu ustawień powiadomień:', err);
  }
}

function playAlertTone() {
  if (!state.settings.notify_sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!state.audioCtx) state.audioCtx = new AudioCtx();
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    const ctx = state.audioCtx;
    const now = ctx.currentTime;
    [587.33, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.13);
      gain.gain.setValueAtTime(0.001, now + idx * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.11, now + idx * 0.13 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.13 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.13);
      osc.stop(now + idx * 0.13 + 0.24);
    });
  } catch (_) {}
}

function showToast(title, body, color, matchKey) {
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.setProperty('--hl-color', normalizeHex(color, '#f59e0b'));
  toast.innerHTML = `<div class="toast-title">${esc(title)}</div><div class="toast-body">${esc(body)}</div>`;
  toast.addEventListener('click', () => {
    if (matchKey) selectMatch(matchKey);
    toast.remove();
  });
  container.prepend(toast);
  while (container.children.length > 4) {
    container.lastElementChild.remove();
  }
  setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, 9000);
}

async function dispatchSystemNotification(title, body, tagKey, matchKey) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  const options = {
    body,
    tag: tagKey,
    renotify: true,
    requireInteraction: false,
    data: { matchKey },
  };
  try {
    if (state.swRegistration) {
      await state.swRegistration.showNotification(title, options);
      return;
    }
  } catch (_) {}
  try {
    const note = new Notification(title, options);
    note.onclick = () => {
      window.focus();
      if (matchKey) selectMatch(matchKey);
      note.close();
    };
  } catch (_) {}
}

function renderNotifyFeed() {
  const feedEl = $('notifyFeed');
  if (!feedEl) return;
  if (!state.notifyHistory.length) {
    feedEl.innerHTML = '<p class="muted">Brak wysłanych alertów w tej sesji. Gdy mecz spełni kryteria „potencjalnej przewagi 3+ goli”, pojawi się powiadomienie systemowe i wpis tutaj.</p>';
    return;
  }
  feedEl.innerHTML = state.notifyHistory
    .map(
      (item) =>
        `<div class="notify-item" data-key="${esc(item.matchKey || '')}" style="--hl-color:${esc(item.color)}"><div class="notify-item-main"><span class="notify-item-tag">${esc(item.tagLabel)}</span><strong>${esc(item.teams)} (${esc(item.score)})</strong><span class="muted">${esc(item.detail)}</span></div><span class="muted">${esc(item.time)}</span></div>`,
    )
    .join('');
  feedEl.querySelectorAll('.notify-item').forEach((row) => {
    row.addEventListener('click', () => {
      if (row.dataset.key) selectMatch(row.dataset.key);
    });
  });
}

function triggerMatchAlert({ title, body, tagLabel, teams, scoreText, detail, color, tagKey, matchKey }) {
  state.notifyTotalSent += 1;
  state.notifyHistory.unshift({
    time: new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    tagLabel,
    teams,
    score: scoreText,
    detail,
    color: normalizeHex(color, '#f59e0b'),
    matchKey,
  });
  if (state.notifyHistory.length > 25) state.notifyHistory.length = 25;
  renderNotifyFeed();
  updateNotifyStatusUI();
  playAlertTone();
  showToast(title, body, color, matchKey);
  dispatchSystemNotification(title, body, tagKey, matchKey);
}

function checkAndDispatchAlerts(liveList) {
  const s = state.settings;
  if (!s.notify_enabled) return;
  const enabledTypes = new Set();
  if (s.notify_potential) enabledTypes.add('potential');
  if (s.notify_primary) enabledTypes.add('primary');
  if (s.notify_high_scoring) enabledTypes.add('high_scoring');
  if (s.notify_close_finish) enabledTypes.add('close_finish');
  if (!enabledTypes.size) return;

  const nowMs = Date.now();
  const cooldownMs = Math.max(0, Number(s.notify_cooldown_seconds ?? 120)) * 1000;

  for (const m of liveList) {
    if (m.is_live === false) continue;
    const evaluation = evaluateHighlights(m);
    const matching = evaluation.tags.filter((t) => enabledTypes.has(t.type));
    if (!matching.length) continue;

    const topTag = matching[0];
    const dedupeKey = `${m.key}|${topTag.type}`;
    const prev = state.notifiedMap.get(dedupeKey);
    const diffNow = evaluation.pred.diff;

    if (prev) {
      const diffIncreased = diffNow > prev.diff;
      if (!diffIncreased) {
        if (cooldownMs === 0) continue;
        if (nowMs - prev.at < cooldownMs) continue;
      }
    }

    state.notifiedMap.set(dedupeKey, { at: nowMs, diff: diffNow });
    const scoreText = score(m);
    const remText = remaining(m);
    const titlePrefix = topTag.type === 'potential' ? 'POTENCJALNE 3+ GOLE' : topTag.type === 'primary' ? 'PRZEWAGA 3+ GOLI' : topTag.label;
    const title = `[${titlePrefix}] ${matchName(m)} (${scoreText})`;
    const body = `Do końca: ${remText} · ${m.half_label || ''} · ${evaluation.pred.outlook}`;

    triggerMatchAlert({
      title,
      body,
      tagLabel: topTag.label,
      teams: matchName(m),
      scoreText,
      detail: `Do końca: ${remText} · prognoza różnicy: ~${evaluation.pred.projectedFinalDiff}`,
      color: topTag.color,
      tagKey: dedupeKey,
      matchKey: m.key,
    });
  }
}

async function requestBrowserNotifications() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    updateNotifyStatusUI();
    showToast('Powiadomienia', 'Ta przeglądarka nie wspiera powiadomień systemowych — działają alerty dźwiękowe i w panelu.', '#f59e0b');
    return;
  }
  try {
    const result = await Notification.requestPermission();
    updateNotifyStatusUI();
    if (result === 'granted') {
      showToast('Powiadomienia włączone', 'Monitor powiadomi Cię w systemie, gdy pojawi się mecz z potencjalną przewagą 3+ goli.', '#63e6be');
    } else if (result === 'denied') {
      showToast('Zgoda odrzucona', 'Odblokuj powiadomienia w ustawieniach witryny przeglądarki lub korzystaj z alertów dźwiękowych.', '#f59e0b');
    }
  } catch (err) {
    console.warn('Nie udało się poprosić o zgodę na powiadomienia:', err);
    updateNotifyStatusUI();
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    state.swRegistration = reg;
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SELECT_MATCH' && event.data.matchKey) {
        selectMatch(event.data.matchKey);
      }
    });
  } catch (err) {
    console.warn('Service Worker niedostępny:', err);
  }
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (response.ok) state.settings = { ...DEFAULT_SETTINGS, ...(await response.json()) };
  } catch (_) {}
  applySettingsToForm(state.settings);
  document.body.classList.toggle('light', state.settings.theme === 'light');
}

async function saveSettings(event) {
  event.preventDefault();
  const settings = readSettingsFromForm();
  try {
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error('settings');
    const saved = await response.json();
    state.settings = { ...DEFAULT_SETTINGS, ...saved };
    syncNotifyControlsFromSettings(state.settings);
    document.body.classList.toggle('light', state.settings.theme === 'light');
    $('settingsDialog').close();
    render();
    startPolling();
  } catch (err) {
    console.error('Nie udało się zapisać ustawień. Sprawdź, czy serwer działa.', err);
    $('sourceNote').textContent = 'błąd zapisu ustawień';
  }
}

function initSwatches() {
  document.querySelectorAll('.swatches').forEach((group) => {
    const targetId = group.dataset.target;
    group.querySelectorAll('.swatch').forEach((btn) => {
      const color = btn.dataset.color;
      btn.style.background = color;
      btn.addEventListener('click', () => {
        const input = $(targetId);
        if (input) input.value = normalizeHex(color);
      });
    });
  });
}

let pollTimer;
let tickTimer;
function startPolling() {
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  if (state.bgWorker) {
    state.bgWorker.terminate();
    state.bgWorker = null;
  }
  state.nextRefreshAtMs = Date.now() + 20_000;

  try {
    const workerCode = `
      setInterval(() => postMessage('tick'), 1000);
      setInterval(() => postMessage('poll'), 20000);
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = (event) => {
      if (event.data === 'poll') loadLive();
      else if (event.data === 'tick') render();
    };
    state.bgWorker = worker;
    return;
  } catch (_) {}

  pollTimer = setInterval(loadLive, 20_000);
  tickTimer = setInterval(render, 1_000);
}

$('demoBtn').addEventListener('click', toggleDemo);
$('refreshBtn').addEventListener('click', () => {
  loadLive();
  startPolling();
});
['searchInput', 'halfFilter', 'statusFilter', 'highlightFilter', 'sortSelect'].forEach((id) => $(id).addEventListener('input', render));
$('clearFilters').addEventListener('click', () => {
  $('searchInput').value = '';
  $('halfFilter').value = 'all';
  $('statusFilter').value = 'all';
  $('highlightFilter').value = 'all';
  render();
});
document.querySelectorAll('.view-btn').forEach((button) =>
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b === button));
    render();
  }),
);
$('settingsBtn').addEventListener('click', () => {
  applySettingsToForm(state.settings);
  $('settingsDialog').showModal();
});
$('closeDialogBtn').addEventListener('click', () => $('settingsDialog').close());
$('resetSettingsBtn').addEventListener('click', () => applySettingsToForm(DEFAULT_SETTINGS));
$('settingsForm').addEventListener('submit', saveSettings);

$('requestNotifyBtn').addEventListener('click', requestBrowserNotifications);
$('testNotifyBtn').addEventListener('click', () => {
  const sampleMatch = currentLiveMatches().find((m) => evaluateHighlights(m).types.includes('potential')) || currentLiveMatches()[0];
  const teams = sampleMatch ? matchName(sampleMatch) : 'Lech_eFC — Legia_eFC';
  const scoreText = sampleMatch ? score(sampleMatch) : '4:2';
  const remText = sampleMatch ? remaining(sampleMatch) : '2:00';
  triggerMatchAlert({
    title: `[TEST · POTENCJALNE 3+ GOLE] ${teams} (${scoreText})`,
    body: `Do końca: ${remText} · Przykładowy alert przeglądarkowy — monitor działa także w tle.`,
    tagLabel: 'TEST ALERTU (POTENCJALNE 3+)',
    teams,
    scoreText,
    detail: `Do końca: ${remText} · test powiadomienia przeglądarkowego`,
    color: state.settings.potential_color || '#f59e0b',
    tagKey: `test-${Date.now()}`,
    matchKey: sampleMatch?.key || null,
  });
});
$('clearNotifyLogBtn').addEventListener('click', () => {
  state.notifyHistory = [];
  state.notifiedMap.clear();
  state.notifyTotalSent = 0;
  renderNotifyFeed();
  updateNotifyStatusUI();
});
$('notifyCollapseBtn').addEventListener('click', () => {
  state.notifyCollapsed = !state.notifyCollapsed;
  $('notifyBody').classList.toggle('hidden', state.notifyCollapsed);
  $('notifyCollapseBtn').textContent = state.notifyCollapsed ? 'Rozwiń' : 'Zwiń';
});
$('notifyToggleChip').addEventListener('click', () => {
  if (state.notifyCollapsed) {
    state.notifyCollapsed = false;
    $('notifyBody').classList.remove('hidden');
    $('notifyCollapseBtn').textContent = 'Zwiń';
  }
  $('notifyPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
['notifyEnabled', 'notifyPotential', 'notifyPrimary', 'notifyHighScoring', 'notifyCloseFinish', 'notifySound', 'notifyCooldown'].forEach((id) => {
  $(id).addEventListener('change', saveNotifySettings);
});

initSwatches();
updateHeroClocks();
updateNotifyStatusUI();
registerServiceWorker();
loadSettings().then(() => {
  loadLive();
  startPolling();
});
