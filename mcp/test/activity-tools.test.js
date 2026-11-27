// list_activities and log_bouldering (src/activity-tools.js). The write goes to a stand-in for the
// api, like write-tools.test.js (as the profile the list tests seeded); the arithmetic is
// frontend/src/lib/log-bouldering.test.js.
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { listActivities, logBoulderingTool } from '../src/activity-tools.js'
import { _resetWriteWindow } from '../src/write-tools.js'
import { _seedStateForTests } from '../src/state.js'
import { toolAllowed } from '../src/server.js'

const TOKEN = 'tok.secret-value'
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const daysAgo = n => { const d = new Date(Date.now() - n * 86400e3); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

const STATE = () => ({
  unit: 'kg', workouts: [],
  activities: {
    run1: { d: daysAgo(1), sport: 'run', min: 40, km: 8.2, src: 'ah', _ts: 1 },
    b1: { d: daysAgo(3), sport: 'climb', min: 90, at: Date.now() - 3 * 86400e3, src: 'manual', _ts: 1, note: 'Strong day',
      bouldering: { gym: 'Crag Hall', scale: 'v', circuits: [{ grade: 'V4', attempts: 3, sends: 2, flashes: 1 }, { grade: 'V6', attempts: 4, sends: 1 }] } },
    gone: { _ts: 9 },
  },
})

describe('list_activities', () => {
  test('lists sport outside the gym with each bouldering session’s grades, and sums the climbing', () => {
    _seedStateForTests(STATE())
    const r = listActivities.handler({})
    expect(r.activities.map(a => a.sport)).toEqual(['run', 'climb'])
    expect(r.activities[0]).toMatchObject({ km: 8.2, source: 'Apple Health', sport_name: 'Run' })
    expect(r.activities[1].bouldering).toMatchObject({ gym: 'Crag Hall', scale: 'v', sends: 3, flashes: 1, falls: 4, top_grade: 'V6', note: 'Strong day' })
    expect(r.climbing).toMatchObject({ sessions: 1, sends: 3, hardest_send: 'V6', hardest_flash: 'V4' })
    expect(listActivities.handler({ sport: 'run' }).activities).toHaveLength(1)
    expect(listActivities.handler({ sport: 'run' }).climbing).toBeUndefined()
  })

  test('is offered to a token that may see workouts, the write only to one that may change them', () => {
    expect(toolAllowed('list_activities', { workouts: 'view' })).toBe(true)
    expect(toolAllowed('log_bouldering', { workouts: 'view' })).toBe(false)
    expect(toolAllowed('log_bouldering', { workouts: 'apply' })).toBe(true)
    expect(toolAllowed('list_activities', { plans: 'apply' })).toBe(false)
  })
})

let api
function stubApi(doc) {
  const s = { doc: structuredClone(doc), rev: 3, puts: [] }
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'not signed in' })
    if (req.url === '/api/me') return send(200, { user: { id: 'test-uid', name: 'Matt' } })
    if (req.url === '/api/data' && req.method === 'GET') return send(200, { state: s.doc, rev: s.rev })
    if (req.url === '/api/data' && req.method === 'PUT') {
      let raw = ''
      for await (const c of req) raw += c
      const body = JSON.parse(raw)
      s.puts.push(body)
      if (body.baseRev !== s.rev) return send(409, { error: 'conflict', rev: s.rev, state: s.doc })
      s.doc = body.state
      s.rev++
      return send(200, { ok: true, rev: s.rev })
    }
    send(404, { error: 'not found' })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    s.server = server
    s.env = { OPENGYM_URL: `http://127.0.0.1:${server.address().port}`, OPENGYM_TOKEN: TOKEN }
    resolve(s)
  }))
}

describe('log_bouldering', () => {
  beforeEach(async () => { _resetWriteWindow(); api = await stubApi(STATE()) })
  afterEach(() => api?.server.close())
  const call = p => logBoulderingTool.handler(p, { env: api.env })
  const SESSION = { gym: 'Crag Hall', duration_min: 80, grades: [{ grade: 'v5', sends: 2, flashes: 1, falls: 2 }, { grade: 'V7', falls: 5 }] }

  test('files the session into the document the server sent, once', async () => {
    const r = await call(SESSION)
    expect(r.saved).toBe(true)
    expect(r.session).toMatchObject({ date: today(), minutes: 80, scale: 'v', sends: 2, falls: 7, top_grade: 'V5', top_flash: 'V5' })
    expect(r.duration_assumed).toBeUndefined()
    expect(api.puts).toHaveLength(1)
    const filed = api.puts[0].state.activities[r.session.id]
    expect(filed).toMatchObject({ sport: 'climb', min: 80, bouldering: { gym: 'Crag Hall', scale: 'v' } })
    expect(api.puts[0].state.activities.run1).toEqual(STATE().activities.run1)
    const again = await call(SESSION)
    expect(again.saved).toBe(false)
    expect(again.problems[0].problem).toMatch(/already logged/)
    expect(api.puts).toHaveLength(1)
  })

  test('a dry run saves nothing and says the length was assumed', async () => {
    const r = await call({ grades: [{ grade: '6A+', sends: 3 }], dry_run: true })
    expect(r).toMatchObject({ saved: false, dry_run: true, would_save: { session: { scale: 'font', sends: 3 }, duration_assumed: true } })
    expect(api.puts).toHaveLength(0)
  })

  test('puts problems back instead of guessing', async () => {
    const r = await call({ grades: [{ grade: 'V3', sends: 1, flashes: 2 }] })
    expect(r.saved).toBe(false)
    expect(r.problems[0]).toMatchObject({ field: 'grades[0]' })
    expect(api.puts).toHaveLength(0)
  })
})
