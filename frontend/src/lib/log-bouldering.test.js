import { describe, expect, it } from 'vitest'
import { buildBoulderingLog, appendBouldering, boulderingView, scaleOfGrades, DEFAULT_MIN } from './log-bouldering.js'
import { activitiesOf } from './activities.js'

const NOW = new Date('2026-11-20T21:00:00').getTime()

describe('log_bouldering', () => {
  it('works out the scale from the grades and files the session the way the phone would', () => {
    const S = {}
    const built = buildBoulderingLog(S, { gym: 'Crag Hall', durationMin: 75, grades: [
      { grade: 'v4', sends: 2, flashes: 1, falls: 3 }, { grade: 'V6', falls: 4 },
    ] }, { now: NOW })
    expect(built.problems).toBeUndefined()
    expect(built.activity).toMatchObject({ d: '2026-11-20', sport: 'climb', min: 75, src: 'manual', bouldering: { gym: 'Crag Hall', scale: 'v' } })
    expect(built.activity.at).toBe(NOW - 75 * 60000)
    expect(appendBouldering(S, built, { now: NOW })).toEqual({ added: true, id: built.id })
    const [a] = activitiesOf(S)
    expect(boulderingView(a.id, a)).toMatchObject({
      scale: 'v', sends: 2, flashes: 1, attempts: 9, falls: 7, top_grade: 'V4', top_flash: 'V4',
      grades: [{ grade: 'V6', sends: 0, flashes: 0, falls: 4 }, { grade: 'V4', sends: 2, flashes: 1, falls: 3 }],
    })
  })

  it('files the same description once', () => {
    const S = {}
    const input = { date: '2026-11-18', grades: [{ grade: '6A', sends: 3 }] }
    appendBouldering(S, buildBoulderingLog(S, input, { now: NOW }), { now: NOW })
    expect(appendBouldering(S, buildBoulderingLog(S, input, { now: NOW }), { now: NOW }).added).toBe(false)
    expect(activitiesOf(S)).toHaveLength(1)
  })

  it('starts a day in the past at the backfill hour and says when the length was assumed', () => {
    const built = buildBoulderingLog({}, { date: '2026-11-18', grades: [{ grade: 'Green', sends: 1 }] }, { now: NOW })
    expect(built.durationAssumed).toBe(true)
    expect(built.activity.min).toBe(DEFAULT_MIN)
    expect(built.activity.bouldering.scale).toBe('vital')
    expect(new Date(built.activity.at).getHours()).toBe(18)
  })

  it('says what is wrong instead of guessing', () => {
    const { problems } = buildBoulderingLog({}, { date: '2026-11-21', durationMin: 0, scale: 'yds', grades: [
      { grade: 'V3', sends: 1, flashes: 2 }, { grade: 'V3' }, { grade: '', sends: 1 }, { grade: 'V2', sends: 1.5 },
    ] }, { now: NOW })
    expect(problems.map(p => p.field)).toEqual(['date', 'durationMin', 'scale', 'grades[0]', 'grades[1]', 'grades[2]', 'grades[3]'])
    expect(buildBoulderingLog({}, { grades: [{ grade: 'V1', sends: 1 }, { grade: 'v1', falls: 2 }] }, { now: NOW }).problems[0].problem).toMatch(/twice/)
    expect(buildBoulderingLog({}, { start: '23:30', grades: [] }, { now: NOW }).problems[0].field).toBe('start')
  })

  it('reads a scale only when every grade is in it', () => {
    expect(scaleOfGrades(['6a+', '7A'])).toBe('font')
    expect(scaleOfGrades(['V0', 'vb'])).toBe('v')
    expect(scaleOfGrades(['V3', '6A'])).toBeNull()
    expect(scaleOfGrades([])).toBeNull()
    expect(scaleOfGrades(['Purple', 'white'])).toBe('vital')
    expect(scaleOfGrades(['Purple', 'Blue'])).toBe('circuit')
  })
})
