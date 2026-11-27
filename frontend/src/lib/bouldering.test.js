import { describe, expect, it } from 'vitest'
import {
  normalizeGrade, gradeRank, readBouldering, newBouldering, logClimb, undoClimb, lastClimb, clearGrade,
  sortedTallies, boulderingSummary, boulderingTotals, finishMinutes, gymsOf, scaleFor, climbingStats,
  gymChoices, startScale, gradeChoices, gradesSeen, LOG_MAX, MAX_GRADES, IDLE_END_MS,
} from './bouldering.js'
import { readActivity, withActivity, activitiesOf } from './activities.js'

const live = (scale = 'v') => newBouldering('Crag Hall', scale, true)
const climb = (b, ...steps) => steps.reduce((x, [g, r], i) => logClimb(x, g, r, 1000 + i), b)

describe('grades', () => {
  it('spells a typed grade the way its scale does, and keeps a gym’s own as typed', () => {
    expect(normalizeGrade('v', ' v4 ')).toBe('V4')
    expect(normalizeGrade('v', 'V 10')).toBe('V10')
    expect(normalizeGrade('v', 'vb')).toBe('VB')
    expect(normalizeGrade('font', '6a+')).toBe('6A+')
    expect(normalizeGrade('font', 'f7b')).toBe('7B')
    expect(normalizeGrade('circuit', 'green')).toBe('Green')
    expect(normalizeGrade('v', 'Comp wall')).toBe('Comp wall')
    expect(normalizeGrade('v', 'V25')).toBe('V25')
    expect(normalizeGrade('v', '   ')).toBe('')
  })

  it('ranks the V and Font scales and never a colour circuit', () => {
    expect(gradeRank('v', 'V5')).toBeGreaterThan(gradeRank('v', 'V4'))
    expect(gradeRank('font', '7A')).toBeGreaterThan(gradeRank('font', '6C+'))
    expect(gradeRank('circuit', 'Black')).toBe(-1)
    expect(gradeRank('v', 'Comp wall')).toBe(-1)
  })
})

describe('logging climbs', () => {
  it('counts a flash as one go and a send, a send as a go and a send, a fall as a go', () => {
    const b = climb(live(), ['V4', 'flash'], ['V4', 'send'], ['V4', 'fall'], ['V5', 'fall'])
    expect(b.circuits).toEqual([
      { grade: 'V4', attempts: 3, sends: 2, flashes: 1 },
      { grade: 'V5', attempts: 1, sends: 0 },
    ])
    expect(b.log.map(e => e.r)).toEqual(['flash', 'send', 'fall', 'fall'])
    expect(b.last).toBe(1003)
  })

  it('undoes the climbs one by one, back to an empty session', () => {
    let b = climb(live(), ['V4', 'flash'], ['V5', 'fall'], ['V5', 'send'])
    expect(lastClimb(b)).toEqual({ g: 'V5', r: 'send' })
    b = undoClimb(b)
    expect(b.circuits).toEqual([{ grade: 'V4', attempts: 1, sends: 1, flashes: 1 }, { grade: 'V5', attempts: 1, sends: 0 }])
    b = undoClimb(undoClimb(b))
    expect(b.circuits).toEqual([])
    expect(b.log).toBeUndefined()
    expect(undoClimb(b)).toBe(b)
  })

  it('remembers only the latest climbs for Undo', () => {
    let b = live()
    for (let i = 0; i < LOG_MAX + 5; i++) b = logClimb(b, 'V2', 'fall', i + 1)
    expect(b.log).toHaveLength(LOG_MAX)
    expect(b.circuits[0].attempts).toBe(LOG_MAX + 5)
  })

  it('keeps no Undo log on a session logged after the fact', () => {
    const b = logClimb(newBouldering('', 'v'), 'V3', 'send', 5)
    expect(b.log).toBeUndefined()
    expect(b.last).toBeUndefined()
  })

  it('refuses a new grade past the most a session keeps', () => {
    let b = newBouldering('', 'v')
    for (let i = 0; i < MAX_GRADES; i++) b = logClimb(b, 'Wall ' + i, 'fall')
    expect(logClimb(b, 'One more', 'send')).toBe(b)
    expect(logClimb(b, 'Wall 3', 'send')).not.toBe(b)
  })

  it('never undoes a climb a hand edit has already taken out', () => {
    const b = { ...climb(live(), ['V3', 'fall']), circuits: [{ grade: 'V3', attempts: 2, sends: 2 }] }
    expect(undoClimb(b).circuits).toEqual([{ grade: 'V3', attempts: 2, sends: 2 }])
  })

  it('clears a grade and its climbs from the Undo log', () => {
    const b = clearGrade(climb(live(), ['V3', 'send'], ['V4', 'fall']), 'v3')
    expect(b.circuits.map(r => r.grade)).toEqual(['V4'])
    expect(b.log).toEqual([{ g: 'V4', r: 'fall' }])
  })
})

describe('reading a session back', () => {
  it('reads a 1.4.5 session as colour circuits and bounds every number', () => {
    expect(readBouldering({ gym: ' VITAL Brooklyn ', circuits: [
      { grade: 'Green', attempts: 2, sends: 5, flashes: 9 }, { grade: 'green', attempts: 4, sends: 1 },
      { grade: 'Red', attempts: 0, sends: 0 }, { grade: '', attempts: 3 },
    ] })).toEqual({ gym: 'VITAL Brooklyn', scale: 'circuit', circuits: [{ grade: 'Green', attempts: 5, sends: 5, flashes: 5 }] })
  })

  it('keeps the Undo log and the last climb only while live, and only for grades it holds', () => {
    const b = { scale: 'v', circuits: [{ grade: 'V4', attempts: 1, sends: 1 }], log: [{ g: 'V4', r: 'send' }, { g: 'V9', r: 'send' }, { g: 'V4', r: 'nope' }], last: 77 }
    expect(readBouldering({ ...b, live: true })).toMatchObject({ live: true, log: [{ g: 'V4', r: 'send' }], last: 77 })
    const done = readBouldering(b)
    expect(done.log).toBeUndefined()
    expect(done.last).toBeUndefined()
  })

  it('makes a live session without a start a finished one', () => {
    const a = readActivity({ d: '2026-11-20', sport: 'climb', min: 30, bouldering: { ...live(), log: [{ g: 'V1', r: 'send' }], circuits: [{ grade: 'V1', attempts: 1, sends: 1 }] } })
    expect(a.bouldering.live).toBeUndefined()
    expect(a.bouldering.log).toBeUndefined()
  })
})

describe('what a session adds up to', () => {
  it('sums the goes and names the hardest send and flash on a ranked scale', () => {
    const b = climb(live('font'), ['6B', 'flash'], ['6C', 'fall'], ['6C', 'send'], ['7A', 'fall'], ['6A+', 'flash'])
    expect(boulderingSummary(b)).toEqual({ scale: 'font', attempts: 5, sends: 3, flashes: 2, grades: 4, top: '6C', topFlash: '6B', rate: 3 / 5 })
    expect(sortedTallies(b).map(r => r.grade)).toEqual(['7A', '6C', '6B', '6A+'])
  })

  it('claims no hardest grade on a colour circuit', () => {
    const b = climb(newBouldering('', 'circuit'), ['Black', 'send'], ['Green', 'flash'], ['Gym roof', 'fall'])
    const s = boulderingSummary(b)
    expect(s.top).toBeNull()
    expect(s.sends).toBe(2)
    expect(sortedTallies(b).map(r => r.grade)).toEqual(['Green', 'Black', 'Gym roof'])
  })

  it('keeps the 1.4.5 totals', () => {
    expect(boulderingTotals([{ grade: 'A', attempts: 4, sends: 1 }])).toEqual({ attempts: 4, sends: 1 })
    expect(boulderingSummary(null).rate).toBeNull()
  })

  it('ends a session left running a few minutes after its last climb', () => {
    const at = 1_000_000
    expect(finishMinutes(at, at + 50 * 60000, at + 52 * 60000)).toBe(52)
    expect(finishMinutes(at, at + 50 * 60000, at + 50 * 60000 + IDLE_END_MS + 1)).toBe(55)
    expect(finishMinutes(at, null, at + 30 * 60000)).toBe(30)
    expect(finishMinutes(at, null, at + 3 * 86400e3)).toBe(24 * 60)
    expect(finishMinutes(0, null, 5)).toBe(1)
  })
})

describe('over time', () => {
  const S = { activities: {} }
  const add = (id, d, b, min = 90) => { S.activities = withActivity(S.activities, id, { d, sport: 'climb', min, at: Date.parse(d + 'T18:00:00'), bouldering: b }, 1) }
  add('a', '2026-11-01', climb(newBouldering('Crag Hall', 'v'), ['V3', 'flash'], ['V4', 'fall'], ['V4', 'send']))
  add('b', '2026-11-08', climb(newBouldering('VITAL Brooklyn', 'circuit'), ['Blue', 'send']), 60)
  add('c', '2026-11-15', climb(newBouldering('crag hall', 'v'), ['V5', 'send'], ['V5', 'fall'], ['V4', 'flash']))
  add('d', '2026-11-22', { ...live(), circuits: [{ grade: 'V9', attempts: 1, sends: 1 }] })
  const sessions = activitiesOf(S)

  it('lists the gyms climbed at, the latest first, each once', () => {
    expect(gymsOf(sessions)).toEqual(['Crag Hall', 'VITAL Brooklyn'])
    expect(gymChoices(sessions)).toEqual(['Crag Hall', 'VITAL Brooklyn', 'VITAL Lower East Side', 'VITAL Upper East Side', 'VITAL Upper West Side'])
  })

  it('starts a gym on the scale it was last climbed on, a suggested gym on its own', () => {
    expect(scaleFor(sessions, 'VITAL Brooklyn')).toBe('circuit')
    expect(scaleFor(sessions, 'CRAG HALL')).toBe('v')
    expect(scaleFor([], 'Anywhere')).toBe('v')
    expect(startScale([], 'VITAL Upper West Side')).toBe('circuit')
    expect(startScale(sessions, 'New place')).toBe('v')
  })

  it('adds up the finished sessions on the scale climbed most', () => {
    const st = climbingStats(sessions, { from: '2026-11-01', to: '2026-11-30' })
    expect(st).toMatchObject({ sessions: 3, minutes: 240, scale: 'v', best: 'V5', bestFlash: 'V4', sends: 5, flashes: 2, attempts: 7 })
    expect(st.pyramid.map(r => [r.grade, r.sends, r.attempts])).toEqual([['V5', 1, 2], ['V4', 2, 3], ['V3', 1, 1]])
    expect(st.tops).toEqual([{ d: '2026-11-01', top: 'V4', rank: 5 }, { d: '2026-11-15', top: 'V5', rank: 6 }])
    expect(climbingStats(sessions, { from: '2026-11-08', to: '2026-11-08' }).scale).toBe('circuit')
  })

  it('offers the grades up to a few past the hardest climbed, and all of them on asking', () => {
    const seen = gradesSeen(sessions, 'v')
    expect(seen).toEqual(expect.arrayContaining(['V3', 'V4', 'V5', 'V9']))
    expect(gradeChoices('v', seen).grades.at(-1)).toBe('V12')
    expect(gradeChoices('v', ['V3', 'V5'])).toEqual({ grades: expect.arrayContaining(['V8']), more: true })
    expect(gradeChoices('v', ['V3', 'V5']).grades.at(-1)).toBe('V8')
    expect(gradeChoices('v', []).grades).toEqual(['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'])
    expect(gradeChoices('v', [], true)).toEqual({ grades: expect.arrayContaining(['V17']), more: false })
    expect(gradeChoices('circuit', ['Gym roof']).grades.at(-1)).toBe('Gym roof')
  })
})
