/* Sport outside the gym (frontend/src/lib/activities.js): list_activities reads runs, matches and
   bouldering sessions, with each session's sends, flashes and grades; log_bouldering files a
   bouldering session the user describes, through the api like log_workout (routine-tools.js
   writePlan: the same profile check, the same retry after another device saved in between).

   The grading rules are the app's own (api/coach/core/bouldering.js through the frontend lib):
   VITAL's colour bands (the default), V grades, Font grades, or another gym's colour circuits,
   which have no hardest grade. */
import { z } from 'zod'
import { getState } from './state.js'
import { isoDate } from './tools.js'
import { writePlan } from './routine-tools.js'
import { activitiesOf, SPORTS, SPORT_LABEL } from '../../frontend/src/lib/activities.js'
import { climbingStats, SCALES, MAX_GRADES, MAX_GYM, MAX_GRADE_LENGTH, MAX_COUNT } from '../../frontend/src/lib/bouldering.js'
import { buildBoulderingLog, appendBouldering, boulderingView, DEFAULT_MIN } from '../../frontend/src/lib/log-bouldering.js'

const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const SOURCE = { hc: 'Health Connect', ah: 'Apple Health', import: 'an import', manual: 'logged in openGym', or: 'openRunning' }
const SCALE_NAME = {
  vital: 'VITAL colours, easiest first: Green VB, Yellow V0-1, Orange V2-3, Red V4-5, Purple V6-7, Black V8-9, White V10+',
  v: 'V scale', font: 'Fontainebleau', circuit: 'colour circuits (no fixed order)',
}

/** list_activities — runs, rides, matches, bouldering sessions; newest first. */
export const listActivities = {
  name: 'list_activities',
  description: 'List the user\'s sport outside the gym, newest first: runs, rides, swims, matches, yoga, and bouldering sessions with their sends, flashes, falls, top grade and every grade climbed. These are not workouts (no sets): list_workouts never shows them. `climbing` sums up the bouldering in the range: sessions, sends, the hardest send and the grade pyramid on the scale climbed most.',
  schema: {
    from: isoDate().optional().describe('Inclusive start date YYYY-MM-DD.'),
    to: isoDate().optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.'),
    sport: z.enum(SPORTS).optional().describe('Only this sport; climb for bouldering.'),
    limit: z.number().int().min(1).max(200).optional().describe('Max items. Defaults to 25.'),
  },
  handler: ({ from, to, sport, limit }) => {
    const S = getState()
    if (!S) return { error: 'no synced state yet: sign in once from a device so the openGym api saves this profile' }
    const hi = to || localIso(new Date())
    const lo = from || ''
    const all = activitiesOf(S).filter(a => a.d >= lo && a.d <= hi && (!sport || a.sport === sport))
    const lim = Math.min(Math.max(limit || 25, 1), 200)
    const climbs = all.filter(a => a.bouldering)
    const stats = climbs.length ? climbingStats(climbs, { from: lo, to: hi }) : null
    return {
      matching_count: all.length,
      returned_count: Math.min(lim, all.length),
      truncated: all.length > lim,
      activities: all.slice(0, lim).map(a => ({
        id: a.id, date: a.d, sport: a.sport, sport_name: SPORT_LABEL[a.sport] || 'Other sport',
        minutes: a.min, ...(a.km ? { km: a.km } : {}), ...(a.title ? { title: a.title } : {}),
        ...(a.note && !a.bouldering ? { note: a.note } : {}), source: SOURCE[a.src] || a.src,
        ...(a.bouldering ? { bouldering: boulderingView(a.id, a) } : {}),
      })),
      ...(stats && stats.sessions ? { climbing: {
        sessions: stats.sessions, minutes: stats.minutes, sends: stats.sends, flashes: stats.flashes, attempts: stats.attempts,
        scale: stats.scale, scale_name: SCALE_NAME[stats.scale], hardest_send: stats.best, hardest_flash: stats.bestFlash,
        pyramid: stats.pyramid.map(r => ({ grade: r.grade, sends: r.sends, flashes: r.flashes || 0, falls: r.attempts - r.sends })),
        top_grade_by_session: stats.tops.map(x => ({ date: x.d, top: x.top })),
      } } : {}),
    }
  },
}

const gradeSchema = z.object({
  grade: z.string().min(1).max(MAX_GRADE_LENGTH).describe('The grade as the gym writes it: a VITAL colour ("Red" is V4-5), "V4", "6A+", another gym\'s colour, or the gym\'s own name for it.'),
  sends: z.number().int().min(0).max(MAX_COUNT).optional().describe('Problems topped on this grade, the flashes included.'),
  flashes: z.number().int().min(0).max(MAX_COUNT).optional().describe('How many of the sends went on the first go.'),
  falls: z.number().int().min(0).max(MAX_COUNT).optional().describe('Goes on this grade that did not top out.'),
})

export const logBoulderingTool = {
  name: 'log_bouldering',
  description: [
    'Log a bouldering session the user describes into openGym (it syncs to all their devices, shows in History and Stats, and tires the climbing muscles in the recovery model).',
    'One entry per grade: sends (flashes included), flashes, falls. "Flashed a V4, sent two V5s after three falls" is [{grade: "V4", sends: 1, flashes: 1}, {grade: "V5", sends: 2, falls: 3}].',
    `The scale is read from the grades unless you pass it: VITAL's colours (Green VB, Yellow V0-1, Orange V2-3, Red V4-5, Purple V6-7, Black V8-9, White V10+), V grades or Font. Without a duration it is logged as ${DEFAULT_MIN} minutes: ask if it matters.`,
    'Call with dry_run: true first when you interpreted anything, show the preview, and log once the user agrees. The same description is never logged twice.',
  ].join(' '),
  schema: {
    date: isoDate().optional().describe('YYYY-MM-DD it was climbed; defaults to today. Not in the future.'),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24 h').optional().describe('When it started, HH:MM, if said.'),
    duration_min: z.number().int().min(1).max(24 * 60).optional().describe('How long the session was, minutes.'),
    gym: z.string().max(MAX_GYM).optional().describe('The climbing gym or crag, as the user names it.'),
    scale: z.enum(SCALES).optional().describe('vital (VITAL\'s colours), v (V grades), font (Fontainebleau) or circuit (another gym\'s colours). Read from the grades when omitted.'),
    grades: z.array(gradeSchema).max(MAX_GRADES).optional().describe('What was climbed, one entry per grade.'),
    note: z.string().max(500).optional(),
    dry_run: z.boolean().optional(),
  },
  handler: async (p, { env = process.env, fetchImpl } = {}) => {
    const now = Date.now()
    const input = { date: p.date, start: p.start, durationMin: p.duration_min, gym: p.gym, scale: p.scale, note: p.note, grades: p.grades || [] }
    let assumed = false
    return writePlan({
      env, fetchImpl, dryRun: p.dry_run === true,
      change: S => {
        const built = buildBoulderingLog(S, input, { now })
        if (built.problems) return built
        assumed = built.durationAssumed
        const added = appendBouldering(S, built, { now })
        if (!added.added) return { problems: [{ field: 'session', problem: `this session is already logged (id ${added.id}); nothing was added` }] }
        return { id: added.id, what: `bouldering ${added.id} for ${built.activity.d}` }
      },
      view: (S, out) => {
        const a = activitiesOf(S).find(x => x.id === out.id)
        return { session: boulderingView(out.id, a), ...(assumed ? { duration_assumed: true } : {}) }
      },
    })
  },
}

export const ACTIVITY_TOOLS = [listActivities, logBoulderingTool]
