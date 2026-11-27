/* Bouldering: how a climbing session is graded, tallied and read back.
 *
 * One module for every reader, so a session means the same thing everywhere: the app
 * (frontend/src/lib/bouldering.js re-exports it, the way lib/streak.js takes streak.js), the
 * Coach (context.js climbingOf) and the MCP tools (through the frontend lib). Pure: no clock,
 * no I/O, `now` is handed in.
 *
 * A session is an activity (frontend/src/lib/activities.js) with sport 'climb' and:
 *
 *   bouldering: {
 *     gym: 'VITAL Brooklyn',             // the person's own text
 *     scale: 'circuit' | 'v' | 'font',   // how the gym grades; sessions from before the scales
 *                                        // have none and are colour circuits
 *     circuits: [{ grade, attempts, sends, flashes? }],
 *                                        // one tally per grade (the key predates the scales)
 *     live?: true,                       // started on the phone, not finished yet
 *     log?: [{ g, r }],                  // while live: the latest climbs, oldest first, so Undo
 *                                        // works after the sheet was closed or on another device
 *     last?: ms,                         // while live: when the latest climb was logged
 *   }
 *
 * attempts counts every go, the sends included; sends <= attempts; flashes (sent on the first
 * go) <= sends. A climb is logged with one of RESULTS: a flash is one go and a send, a send
 * one go and a send, a fall one go.
 */

export const SCALES = ['circuit', 'v', 'font'];
export const SCALE_LABEL = { circuit: 'Colours', v: 'V scale', font: 'Font' };

// Colour circuits, in the order the picker shows them. A gym's own order of difficulty is its
// own, so a circuit has no rank: no "hardest grade" is claimed for one.
export const CIRCUIT_COLORS = {
  Green: '#4ca66a', Yellow: '#e8ba36', Blue: '#4a91e9', Orange: '#ee8748',
  Red: '#db525b', Pink: '#e879ad', Purple: '#9a76d5', Black: '#25252b',
  White: '#f4f4f5', Gray: '#8a8b93',
};
export const V_GRADES = ['VB', ...Array.from({ length: 18 }, (_, i) => 'V' + i)];
export const FONT_GRADES = ['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+',
  '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'];
export const SCALE_GRADES = { circuit: Object.keys(CIRCUIT_COLORS), v: V_GRADES, font: FONT_GRADES };
const RANKED = new Set(['v', 'font']);

export const RESULTS = ['flash', 'send', 'fall'];
export const MAX_COUNT = 999;
export const MAX_GRADES = 24;
export const MAX_GRADE_LENGTH = 32;
export const MAX_GYM = 80;
export const LOG_MAX = 60;

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const count = v => (Number.isFinite(Number(v)) ? Math.min(MAX_COUNT, Math.max(0, Math.trunc(Number(v)))) : 0);
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export const scaleOf = b => (isMap(b) && SCALES.includes(b.scale) ? b.scale : 'circuit');
export const isRanked = scale => RANKED.has(scale);

/**
 * A grade as typed, in the scale's own spelling when it is one of its grades: "v4" and "V 4" are
 * V4, "6a+" is 6A+, "green" is Green. Anything else is kept as typed, a grade of the gym's own.
 */
export function normalizeGrade(scale, raw) {
  const s = text(raw, MAX_GRADE_LENGTH);
  if (!s) return '';
  const list = SCALE_GRADES[SCALES.includes(scale) ? scale : 'circuit'];
  const hit = list.find(g => same(g, s));
  if (hit) return hit;
  if (scale === 'v') {
    const m = /^v\s*-?\s*(b|\d{1,2})$/i.exec(s);
    if (m) { const g = 'V' + m[1].toUpperCase(); if (list.includes(g)) return g; }
  }
  if (scale === 'font') {
    const m = /^f?\s*(\d)\s*([abc])?\s*(\+)?$/i.exec(s);
    if (m) { const g = m[1] + (m[2] ? m[2].toUpperCase() : '') + (m[3] || ''); if (list.includes(g)) return g; }
  }
  return s;
}

/** Where a grade sits on a ranked scale (0 easiest), or -1: a circuit colour, a gym's own name. */
export function gradeRank(scale, grade) {
  return isRanked(scale) ? SCALE_GRADES[scale].indexOf(grade) : -1;
}

/** The colour a circuit grade is painted, or null. */
export const gradeColor = (scale, grade) => (scale === 'circuit' && Object.hasOwn(CIRCUIT_COLORS, grade) ? CIRCUIT_COLORS[grade] : null);

function readLog(log, grades) {
  if (!Array.isArray(log)) return [];
  return log.slice(-LOG_MAX).map(e => ({ g: text(e?.g, MAX_GRADE_LENGTH), r: RESULTS.includes(e?.r) ? e.r : null }))
    .filter(e => e.g && e.r && grades.has(e.g.toLowerCase()));
}

/** A stored session read back, bounded field by field, or null for anything that is not one. */
export function readBouldering(value) {
  if (!isMap(value)) return null;
  const gym = text(value.gym, MAX_GYM);
  const scale = scaleOf(value);
  const circuits = [];
  const seen = new Set();
  for (const row of Array.isArray(value.circuits) ? value.circuits.slice(0, MAX_GRADES * 2) : []) {
    const grade = text(row?.grade, MAX_GRADE_LENGTH);
    const key = grade.toLowerCase();
    const sends = count(row?.sends);
    const attempts = Math.max(count(row?.attempts), sends);
    const flashes = Math.min(count(row?.flashes), sends);
    if (!grade || !attempts || seen.has(key) || circuits.length >= MAX_GRADES) continue;
    seen.add(key);
    circuits.push({ grade, attempts, sends, ...(flashes ? { flashes } : {}) });
  }
  const out = { gym, scale, circuits };
  if (value.live === true) {
    out.live = true;
    const log = readLog(value.log, seen);
    if (log.length) out.log = log;
    const last = Number(value.last);
    if (last > 0 && Number.isFinite(last)) out.last = last;
  }
  return out;
}

/** An empty session at `gym`, graded on `scale`. */
export const newBouldering = (gym = '', scale = 'circuit', live = false) => ({
  gym: text(gym, MAX_GYM), scale: SCALES.includes(scale) ? scale : 'circuit', circuits: [], ...(live ? { live: true } : {}),
});

function bump(row, result, dir) {
  const d = dir > 0 ? 1 : -1;
  return {
    ...row,
    attempts: row.attempts + d,
    sends: row.sends + (result === 'fall' ? 0 : d),
    flashes: (row.flashes || 0) + (result === 'flash' ? d : 0),
  };
}
const tidy = row => {
  const { flashes, ...rest } = row;
  return flashes > 0 ? { ...rest, flashes } : rest;
};

/**
 * `b` with one climb more on `grade`: a flash, a send or a fall. A live session remembers it for
 * Undo, and when (`now`). The same object back when it cannot take it: no grade, a tally at
 * the cap, or a new grade past the most a session keeps.
 */
export function logClimb(b, rawGrade, result, now) {
  if (!isMap(b) || !RESULTS.includes(result)) return b;
  const circuits = Array.isArray(b.circuits) ? b.circuits : [];
  const grade = normalizeGrade(scaleOf(b), rawGrade);
  if (!grade) return b;
  const i = circuits.findIndex(r => same(r.grade, grade));
  if (i < 0 && circuits.length >= MAX_GRADES) return b;
  const row = i < 0 ? { grade, attempts: 0, sends: 0 } : circuits[i];
  if (row.attempts >= MAX_COUNT) return b;
  const next = tidy(bump(row, result, 1));
  const rows = i < 0 ? [...circuits, next] : circuits.map((r, k) => (k === i ? next : r));
  const out = { ...b, circuits: rows };
  if (b.live) {
    out.log = [...(Array.isArray(b.log) ? b.log : []), { g: row.grade, r: result }].slice(-LOG_MAX);
    if (Number.isFinite(now) && now > 0) out.last = now;
  }
  return out;
}

/** The climb before, for Undo: the last one logged, or null. */
export const lastClimb = b => (isMap(b) && Array.isArray(b.log) && b.log.length ? b.log[b.log.length - 1] : null);

/** `b` without its latest logged climb (Undo). The same object back when there is none to undo. */
export function undoClimb(b) {
  const last = lastClimb(b);
  if (!last) return b;
  const log = b.log.slice(0, -1);
  const i = b.circuits.findIndex(r => same(r.grade, last.g));
  const out = { ...b, log };
  if (!log.length) delete out.log;
  if (i < 0) return out;
  const row = b.circuits[i];
  // A tally edited by hand since may no longer hold the climb; never below zero, never sends past tries.
  if (row.attempts < 1 || (last.r !== 'fall' ? row.sends < 1 : row.attempts <= row.sends)) return out;
  const prev = tidy(bump(row, last.r, -1));
  if (prev.flashes > prev.sends) prev.flashes = prev.sends;
  out.circuits = prev.attempts > 0 ? b.circuits.map((r, k) => (k === i ? prev : r)) : b.circuits.filter((_, k) => k !== i);
  return out;
}

/** `b` without the tally for `grade` (and its climbs in the Undo log). */
export function clearGrade(b, grade) {
  if (!isMap(b)) return b;
  const out = { ...b, circuits: (b.circuits || []).filter(r => !same(r.grade, grade)) };
  if (Array.isArray(b.log)) {
    out.log = b.log.filter(e => !same(e.g, grade));
    if (!out.log.length) delete out.log;
  }
  return out;
}

/** The tallies in the order a session reads: hardest first on a ranked scale, the picker's
 *  order for colours, and grades of the gym's own after them as they came. */
export function sortedTallies(b) {
  const scale = scaleOf(b);
  const list = SCALE_GRADES[scale];
  const at = g => { const i = list.indexOf(g); return i < 0 ? Infinity : i; };
  const rows = (isMap(b) && Array.isArray(b.circuits) ? b.circuits : []).map((r, i) => ({ r, i }));
  rows.sort((x, y) => {
    const a = at(x.r.grade), c = at(y.r.grade);
    if (a === c) return x.i - y.i;
    if (a === Infinity) return 1;
    if (c === Infinity) return -1;
    return isRanked(scale) ? c - a : a - c;
  });
  return rows.map(x => x.r);
}

/** The hardest grade among rows that pass `keep`, on a ranked scale; null otherwise. */
function hardest(scale, rows, keep) {
  let best = null, rank = -1;
  for (const r of rows) {
    if (!keep(r)) continue;
    const k = gradeRank(scale, r.grade);
    if (k > rank) { rank = k; best = r.grade; }
  }
  return best;
}

/**
 * What a session adds up to: { scale, attempts, sends, flashes, grades, top, topFlash, rate }.
 * `top` is the hardest grade sent and `topFlash` the hardest flashed, on a ranked scale only;
 * `rate` the share of goes that were sends (0 to 1), null before the first.
 */
export function boulderingSummary(b) {
  const scale = scaleOf(b);
  const rows = isMap(b) && Array.isArray(b.circuits) ? b.circuits : [];
  let attempts = 0, sends = 0, flashes = 0;
  for (const r of rows) { attempts += r.attempts; sends += r.sends; flashes += r.flashes || 0; }
  return {
    scale, attempts, sends, flashes, grades: rows.length,
    top: hardest(scale, rows, r => r.sends > 0),
    topFlash: hardest(scale, rows, r => (r.flashes || 0) > 0),
    rate: attempts ? sends / attempts : null,
  };
}

/** Kept for the 1.4.5 callers: { attempts, sends } of a list of tallies. */
export function boulderingTotals(circuits) {
  const s = boulderingSummary({ circuits: Array.isArray(circuits) ? circuits : [] });
  return { attempts: s.attempts, sends: s.sends };
}

// A session left running: past this long after its latest climb, it ended a few minutes after
// that climb, not when Finish was finally tapped (the next morning, say).
export const IDLE_END_MS = 45 * 60000;
export const IDLE_TAIL_MS = 5 * 60000;

/** The minutes a live session ran when it is finished at `now`. */
export function finishMinutes(at, last, now, max = 24 * 60) {
  const start = Number(at);
  if (!(start > 0)) return 1;
  const end = Number(last) > start && now - last > IDLE_END_MS ? last + IDLE_TAIL_MS : now;
  return Math.min(max, Math.max(1, Math.round((end - start) / 60000)));
}

/* ------------------------------------------------------------- over time ---- */

// `sessions` below: activities as the app reads them (activities.js activitiesOf), newest first,
// each with its `bouldering` read back by readBouldering.

/** The gyms climbed at, the latest first, each once. */
export function gymsOf(sessions) {
  const out = [];
  for (const a of Array.isArray(sessions) ? sessions : []) {
    const g = a?.bouldering?.gym;
    if (g && !out.some(x => same(x, g))) out.push(g);
  }
  return out;
}

/** The scale a new session at `gym` starts on: that gym's last, else the latest session's, else `fallback`. */
export function scaleFor(sessions, gym, fallback = 'v') {
  const list = (Array.isArray(sessions) ? sessions : []).filter(a => a?.bouldering);
  const at = gym ? list.find(a => a.bouldering.gym && same(a.bouldering.gym, gym)) : null;
  const pick = at || list[0];
  return pick ? scaleOf(pick.bouldering) : (SCALES.includes(fallback) ? fallback : 'v');
}

/**
 * The climbing in `sessions` between `from` and `to` (ISO days, both optional): how many
 * sessions, minutes, goes, sends and flashes; the scale climbed most; the grade pyramid on that
 * scale (sends, flashes and goes per grade, as sortedTallies orders it); the hardest send and
 * flash on it (ranked scales); and each session's top send, oldest first, for a trend.
 */
export function climbingStats(sessions, { from = '', to = '9999-12-31' } = {}) {
  const list = (Array.isArray(sessions) ? sessions : [])
    .filter(a => a?.bouldering && !a.bouldering.live && typeof a.d === 'string' && a.d >= from && a.d <= to);
  const byScale = {};
  for (const a of list) { const s = scaleOf(a.bouldering); byScale[s] = (byScale[s] || 0) + 1; }
  const scale = Object.entries(byScale).sort((x, y) => y[1] - x[1] || SCALES.indexOf(x[0]) - SCALES.indexOf(y[0]))[0]?.[0] || 'circuit';
  let minutes = 0, attempts = 0, sends = 0, flashes = 0;
  const pyramid = { scale, circuits: [] };
  const tops = [];
  for (const a of list) {
    const s = boulderingSummary(a.bouldering);
    minutes += Number(a.min) || 0; attempts += s.attempts; sends += s.sends; flashes += s.flashes;
    if (s.scale !== scale) continue;
    for (const r of a.bouldering.circuits) {
      const i = pyramid.circuits.findIndex(x => same(x.grade, r.grade));
      const row = i < 0 ? { grade: r.grade, attempts: 0, sends: 0, flashes: 0 } : pyramid.circuits[i];
      const next = { ...row, attempts: row.attempts + r.attempts, sends: row.sends + r.sends, flashes: row.flashes + (r.flashes || 0) };
      if (i < 0) pyramid.circuits.push(next); else pyramid.circuits[i] = next;
    }
    if (s.top) tops.push({ d: a.d, top: s.top, rank: gradeRank(scale, s.top) });
  }
  const summary = boulderingSummary(pyramid);
  return {
    sessions: list.length, minutes, attempts, sends, flashes, scale,
    pyramid: sortedTallies(pyramid), best: summary.top, bestFlash: summary.topFlash,
    tops: tops.reverse(),
  };
}
