// A bouldering session described in words ("V4 flashed, two V5 sends after a few falls, at Crag
// Hall, an hour and a half") built into an activity (lib/activities.js, lib/bouldering.js), for
// the MCP's log_bouldering (mcp/src/activity-tools.js). The language is the assistant's job; this
// checks the numbers, works out the scale, and files the session the way the phone would.
import { SCALES, SCALE_GRADES, MAX_COUNT, MAX_GRADES, MAX_GYM, normalizeGrade, readBouldering, scaleFor, sortedTallies, boulderingSummary } from './bouldering.js'
import { activitiesOf, readActivity, withActivity, ACTIVITY_MIN_MAX } from './activities.js'
import { backfillStart } from './backfill.js'
import { hashId } from './weigh-ins.js'
import { NOTE_MAX } from './history.js'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const DEFAULT_MIN = 90
const localIso = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const whole = v => (Number.isInteger(v) && v >= 0 ? v : null)

/** The scale a list of grades is written in: the one every grade belongs to, else null. */
export function scaleOfGrades(grades) {
  const list = grades.map(g => String(g || '').trim()).filter(Boolean)
  if (!list.length) return null
  for (const s of ['v', 'font', 'circuit']) {
    if (list.every(g => SCALE_GRADES[s].includes(normalizeGrade(s, g)))) return s
  }
  return null
}

/**
 * `input`: { date, start?, durationMin?, gym?, scale?, note?, grades: [{ grade, sends?, flashes?,
 * falls? }] } with sends counting the flashes too and falls the goes that did not go. → { problems }
 * or { id, activity, durationAssumed } ready for appendBouldering.
 */
export function buildBoulderingLog(S, input, { now = Date.now() } = {}) {
  const problems = []
  const today = localIso(now)
  const date = input?.date || today
  if (!ISO.test(date) || localIso(new Date(date + 'T12:00:00')) !== date) problems.push({ field: 'date', problem: 'must be a real YYYY-MM-DD' })
  else if (date > today) problems.push({ field: 'date', problem: 'is in the future' })
  if (input?.start != null && !HHMM.test(String(input.start))) problems.push({ field: 'start', problem: 'must be HH:MM (24 h)' })
  const dur = input?.durationMin == null ? null : Math.round(Number(input.durationMin))
  if (dur != null && !(dur >= 1 && dur <= ACTIVITY_MIN_MAX)) problems.push({ field: 'durationMin', problem: `must be 1 to ${ACTIVITY_MIN_MAX} minutes` })
  const gym = typeof input?.gym === 'string' ? input.gym.trim().slice(0, MAX_GYM) : ''
  const rows = Array.isArray(input?.grades) ? input.grades : []
  if (rows.length > MAX_GRADES) problems.push({ field: 'grades', problem: `at most ${MAX_GRADES} grades in one session` })
  if (input?.scale != null && !SCALES.includes(input.scale)) problems.push({ field: 'scale', problem: `one of ${SCALES.join(', ')}` })
  const sessions = activitiesOf(S)
  const scale = input?.scale || scaleOfGrades(rows.map(r => r?.grade)) || scaleFor(sessions, gym, 'v')
  const circuits = []
  rows.forEach((r, i) => {
    const where = `grades[${i}]`
    const grade = normalizeGrade(scale, r?.grade)
    const sends = whole(r?.sends ?? 0), flashes = whole(r?.flashes ?? 0), falls = whole(r?.falls ?? 0)
    if (!grade) { problems.push({ field: where, problem: 'needs a grade' }); return }
    if (sends == null || flashes == null || falls == null) { problems.push({ field: where, problem: 'sends, flashes and falls are whole numbers, 0 or more' }); return }
    if (flashes > sends) { problems.push({ field: where, problem: 'flashes are sends too: sends must be at least the flashes' }); return }
    if (!(sends + falls)) { problems.push({ field: where, problem: `${grade} has no climbs: give its sends or falls` }); return }
    if (sends + falls > MAX_COUNT) { problems.push({ field: where, problem: `at most ${MAX_COUNT} goes on one grade` }); return }
    if (circuits.some(c => c.grade.toLowerCase() === grade.toLowerCase())) { problems.push({ field: where, problem: `${grade} is listed twice: add them up into one` }); return }
    circuits.push({ grade, attempts: sends + falls, sends, ...(flashes ? { flashes } : {}) })
  })
  const note = typeof input?.note === 'string' ? input.note.trim().slice(0, NOTE_MAX) : ''
  if (problems.length) return { problems }

  const min = dur ?? DEFAULT_MIN
  let at
  if (input.start != null) at = new Date(`${date}T${input.start}:00`).getTime()
  else if (date === today) at = Math.max(new Date(`${date}T00:00:00`).getTime(), now - min * 60000)
  else at = backfillStart(date)
  if (at > now) return { problems: [{ field: 'start', problem: 'is later than now' }] }
  const bouldering = readBouldering({ gym, scale, circuits })
  // What was described, never the filled-in start: the same description is the same session.
  const id = 'b' + hashId(JSON.stringify([date, input.start ?? null, dur, gym.toLowerCase(), scale, circuits]))
  const activity = readActivity({ d: date, sport: 'climb', min, at, note, src: 'manual', bouldering })
  return { id, activity, durationAssumed: dur == null }
}

/** The session filed into S.activities (mutates S), unless that same description is there already. */
export function appendBouldering(S, built, { now = Date.now() } = {}) {
  const had = S.activities && Object.hasOwn(S.activities, built.id) ? readActivity(S.activities[built.id]) : null
  if (had) return { added: false, id: built.id }
  S.activities = withActivity(S.activities, built.id, built.activity, now)
  return { added: true, id: built.id }
}

/** A session as the MCP tools show it. */
export function boulderingView(id, a) {
  const b = a.bouldering
  const s = boulderingSummary(b)
  return {
    id, date: a.d, minutes: a.min, gym: b.gym || null, scale: b.scale, ...(b.live ? { in_progress: true } : {}),
    sends: s.sends, flashes: s.flashes, attempts: s.attempts, falls: s.attempts - s.sends,
    top_grade: s.top, top_flash: s.topFlash,
    grades: sortedTallies(b).map(r => ({ grade: r.grade, sends: r.sends, flashes: r.flashes || 0, falls: r.attempts - r.sends })),
    ...(a.note ? { note: a.note } : {}),
  }
}
