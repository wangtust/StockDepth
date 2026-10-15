import assert from 'node:assert/strict';
import {nextDailyCloseAt} from '../../apps/web/lib/market/policy';
for (const [now,expected] of [
  ['2026-10-15T19:00:00Z','2026-10-15T20:45:00.000Z'],
  ['2026-10-15T21:00:00Z','2026-10-16T20:45:00.000Z'],
  ['2026-03-06T22:00:00Z','2026-03-09T20:45:00.000Z'],
  ['2026-10-30T22:00:00Z','2026-11-02T21:45:00.000Z'],
  ['2026-10-17T12:00:00Z','2026-10-19T20:45:00.000Z'],
]) assert.equal(nextDailyCloseAt('XNYS','America/New_York',new Date(now)).toISOString(),expected);
console.log('PASS: close scheduling, next day, weekends, spring and autumn DST transitions.');
