/* Sport outside the gym in the Coach's payload (core/context.js activitiesOf): the last 14 days,
 * a bouldering session with its sends and grades, behind the `activities` switch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { activitiesOf, MAX_ACTIVITIES } from '../coach/core/context.js';
import { build } from '../coach/core/payload.js';
import { logClimb, newBouldering, climbingStats, readBouldering, undoClimb, finishMinutes } from '../coach/core/bouldering.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const climbs = (b, list) => list.reduce((x, [g, r]) => logClimb(x, g, r, NOW), b);

const S = {
  activities: {
    r1: { d: day(1), sport: 'run', min: 42, km: 8.123, at: NOW - 86400000, src: 'ah', _ts: 1 },
    c1: { d: day(2), sport: 'climb', min: 95, src: 'manual', _ts: 1, bouldering: climbs(newBouldering('My Secret Gym', 'v'), [
      ['V4', 'flash'], ['V5', 'fall'], ['V5', 'send'], ['Kids wall', 'send'],
    ]) },
    c2: { d: day(3), sport: 'climb', min: 60, src: 'manual', _ts: 1, bouldering: climbs(newBouldering('', 'circuit'), [['Blue', 'send'], ['Black', 'fall']]) },
    live: { d: day(0), sport: 'climb', min: 20, at: NOW - 1200000, src: 'manual', _ts: 1, bouldering: { ...newBouldering('', 'v', true), circuits: [{ grade: 'V2', attempts: 1, sends: 1 }] } },
    old: { d: day(20), sport: 'ride', min: 60, _ts: 1 },
    gone: { _ts: 5 },
    odd: { d: day(4), sport: 'parkour', min: 30, _ts: 1 },
  },
};

test('the last 14 days, newest first, a bouldering session with its sends and the scale grades', () => {
  const a = activitiesOf(S, NOW);
  assert.deepEqual(a.map(x => x.sport), ['run', 'climb', 'climb', 'other']);
  assert.deepEqual(a[0], { d: day(1), sport: 'run', min: 42, km: 8.1 });
  assert.deepEqual(a[1].climb, {
    scale: 'v', sends: 3, flashes: 1, attempts: 4, top: 'V5',
    grades: [{ grade: 'V4', sends: 1, attempts: 1 }, { grade: 'V5', sends: 1, attempts: 2 }],
  });
  assert.equal(a[2].climb.top, undefined, 'a colour circuit has no hardest grade');
  assert.deepEqual(a[2].climb.grades.map(g => g.grade), ['Blue', 'Black']);
  assert.ok(!JSON.stringify(a).includes('Secret'), 'the gym’s name stays home');
  assert.ok(!JSON.stringify(a).includes('Kids wall'), 'a gym’s own grade names stay home');
});

test('never more than the cap, and nothing from a broken document', () => {
  const many = { activities: Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['a' + i, { d: day(i % 10), sport: 'run', min: 30 }])) };
  assert.equal(activitiesOf(many, NOW).length, MAX_ACTIVITIES);
  assert.deepEqual(activitiesOf({ activities: [1, 2] }, NOW), []);
  assert.deepEqual(activitiesOf(null, NOW), []);
});

test('in a review and a question, unless switched off; never in a new plan', () => {
  const opts = { handle: 'h'.repeat(16), now: NOW };
  assert.equal(build(S, { ...opts, kind: 'ask', note: 'can I lift today?' }).activities.length, 4);
  assert.equal(build(S, { ...opts, kind: 'review' }).activities.length, 4);
  assert.equal(build({ ...S, coach: { share: { activities: false } } }, { ...opts, kind: 'review' }).activities, undefined);
  assert.equal(build(S, { ...opts, kind: 'create' }).activities, undefined);
});

test('the shared bouldering rules read the same on the server', () => {
  const b = climbs(newBouldering('x', 'font', true), [['6a', 'fall'], ['6A', 'send'], ['6b+', 'flash']]);
  assert.deepEqual(b.circuits, [{ grade: '6A', attempts: 2, sends: 1 }, { grade: '6B+', attempts: 1, sends: 1, flashes: 1 }]);
  assert.deepEqual(undoClimb(b).circuits, [{ grade: '6A', attempts: 2, sends: 1 }]);
  assert.equal(readBouldering({ ...b, live: false }).log, undefined);
  const st = climbingStats([{ d: day(1), min: 60, bouldering: readBouldering({ ...b, live: false }) }]);
  assert.equal(st.best, '6B+');
  assert.equal(finishMinutes(NOW - 3600000, NOW - 3500000, NOW), 7);
});
