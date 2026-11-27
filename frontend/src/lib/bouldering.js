// Bouldering sessions (sport 'climb' with a `bouldering` block, lib/activities.js). The rules,
// grade scales and read-back live in api/coach/core/bouldering.js, shared with the Coach and the
// MCP tools so a session adds up the same everywhere; this re-exports them for the app and adds
// what only the app needs.
export {
  SCALES, SCALE_LABEL, DEFAULT_SCALE, CIRCUIT_COLORS, VITAL_GRADES, VITAL_RANGE, V_GRADES, FONT_GRADES, SCALE_GRADES, RESULTS,
  MAX_COUNT, MAX_GRADES, MAX_GRADE_LENGTH, MAX_GYM, LOG_MAX, IDLE_END_MS,
  scaleOf, isRanked, normalizeGrade, gradeRank, gradeRange, gradeColor, readBouldering, newBouldering,
  logClimb, lastClimb, undoClimb, clearGrade, sortedTallies, boulderingSummary, boulderingTotals,
  finishMinutes, gymsOf, scaleFor, climbingStats,
} from '../../../api/coach/core/bouldering.js'
import { DEFAULT_SCALE, SCALE_GRADES, gradeRank, gymsOf, isRanked, scaleFor } from '../../../api/coach/core/bouldering.js'

// Gyms offered before you have climbed anywhere, each with the way it grades. Your own gyms
// (the ones in your sessions) always come first.
export const SUGGESTED_GYMS = [
  { name: 'VITAL Brooklyn', scale: 'vital' },
  { name: 'VITAL Lower East Side', scale: 'vital' },
  { name: 'VITAL Upper East Side', scale: 'vital' },
  { name: 'VITAL Upper West Side', scale: 'vital' },
]
/** @deprecated the 1.4.5 name, kept for anything still importing it. */
export const VITAL_GYMS = SUGGESTED_GYMS.map(g => g.name)

/** The gyms the picker offers: yours, the latest first, then the suggestions you have not used. */
export function gymChoices(sessions, max = 6) {
  const own = gymsOf(sessions)
  const rest = SUGGESTED_GYMS.map(g => g.name).filter(n => !own.some(o => o.toLowerCase() === n.toLowerCase()))
  return [...own, ...rest].slice(0, Math.max(own.length, max))
}

/** The scale a suggested gym grades on, or null for one of your own. */
export const suggestedScale = gym => SUGGESTED_GYMS.find(g => g.name.toLowerCase() === String(gym || '').toLowerCase())?.scale || null

/** The scale a new session at `gym` starts on: that gym's last session's, a suggested gym's own,
 *  else the latest session's, else VITAL's colours. */
export function startScale(sessions, gym) {
  const g = String(gym || '').toLowerCase()
  const been = g && (Array.isArray(sessions) ? sessions : []).some(a => String(a?.bouldering?.gym || '').toLowerCase() === g)
  return (!been && suggestedScale(gym)) || scaleFor(sessions, gym, DEFAULT_SCALE)
}

// On a ranked scale the picker shows the grades up to a few past the hardest you have climbed
// (at least to V6 / 6C), so 19 V grades do not bury the ones you climb. "All grades" shows them all.
const WINDOW_AHEAD = 3
const WINDOW_MIN = { vital: 7, v: 8, font: 10 }

/**
 * The grades the picker offers for `scale`: the scale's own (on a ranked scale up to a few past
 * the hardest in `seen`, unless `all`), then any of the gym's own grades in `seen`. `more` says
 * whether grades were held back.
 */
export function gradeChoices(scale, seen = [], all = false) {
  const list = SCALE_GRADES[scale] || SCALE_GRADES.circuit
  const own = [...new Set(seen.filter(g => g && !list.includes(g)))]
  if (!isRanked(scale) || all) return { grades: [...list, ...own], more: false }
  const top = Math.max(-1, ...seen.map(g => gradeRank(scale, g)))
  const end = Math.min(list.length, Math.max(WINDOW_MIN[scale] || 0, top + 1 + WINDOW_AHEAD))
  return { grades: [...list.slice(0, end), ...own], more: end < list.length }
}

/** The grades of every tally in `sessions` on `scale`, for gradeChoices. */
export function gradesSeen(sessions, scale) {
  const out = new Set()
  for (const a of Array.isArray(sessions) ? sessions : []) {
    const b = a?.bouldering
    if (!b || (b.scale || DEFAULT_SCALE) !== scale) continue
    for (const r of b.circuits || []) out.add(r.grade)
  }
  return [...out]
}
