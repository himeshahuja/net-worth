import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, addDays, categoryOfType, changeOver, changeSince, dayOn, endOfLastMonth, milestones, milestoneStep, months, net, own, owe, partsOf, periods, records, typeLabel, typesUsed } from './networth.js';
import { sampleHistory } from './sample.js';
import { money, signed, compact } from './format.js';

const day = (date, cash, loans = 0) => ({ date, cash, investments: 0, retirement: 0, other: 0, credit: 0, loans });

test('net worth is what is owned less what is owed', () => {
  const d = { date: '2026-10-31', cash: 100, investments: 50, retirement: 25, other: 0, credit: 30, loans: 200 };
  assert.equal(own(d), 175);
  assert.equal(owe(d), 230);
  assert.equal(net(d), -55);
});

test('dates step across month and year ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(endOfLastMonth('2026-03-15'), '2026-02-28');
});

test('a change runs from the baseline, or from the first snapshot when tracking began later', () => {
  const days = [day('2026-09-29', 100), day('2026-09-30', 120), day('2026-10-31', 200)];
  assert.equal(dayOn(days, '2026-10-15').date, '2026-09-30');
  assert.deepEqual(changeSince(days, '2026-09-30'), { from: '2026-09-30', started: false, net: 80, own: 80, owe: 0 });
  assert.equal(changeSince(days, '2026-09-01').started, true);
  assert.equal(changeSince([days[0]], '2026-09-01'), null);
});

test('month closes come newest first, each with its change', () => {
  const list = months([day('2026-09-10', 100), day('2026-09-30', 150), day('2026-10-05', 140), day('2026-10-31', 210)]);
  assert.deepEqual(list.map((m) => [m.month, net(m.day), m.change]), [['2026-10', 210, 60], ['2026-09', 150, null]]);
});

test('milestones mark new records only, including climbing out of debt', () => {
  const values = [-1500, -200, 300, 9000, 11000, 8000, 10500, 21000];
  const days = values.map((v, i) => day(addDays('2026-01-01', i), v));
  assert.equal(milestoneStep(days), 10000);
  assert.deepEqual(milestones(days).map((m) => [m.index, m.value]), [[2, 0], [4, 10000], [7, 20000]]);
});

test('the sample history adds up and runs day by day to today', () => {
  const h = sampleHistory('2026-10-31');
  assert.equal(h.days.at(-1).date, '2026-10-31');
  h.days.forEach((d, i) => {
    if (i) assert.equal(d.date, addDays(h.days[i - 1].date, 1));
    for (const c of CATEGORIES) {
      assert.ok(Number.isInteger(d[c.key]) && d[c.key] >= 0, `${d.date} ${c.key} ${d[c.key]}`);
      const parts = Object.entries(d.types).filter(([k]) => categoryOfType(k) === c.key);
      assert.equal(parts.reduce((s, [, v]) => s + v, 0), d[c.key], `${d.date} ${c.key} parts`);
    }
  });
  assert.ok(net(h.days[0]) < 0 && net(h.days.at(-1)) > 25000);
  assert.deepEqual(sampleHistory('2026-10-31'), h);
});

test('types are labelled, and an old day without types counts one part per category', () => {
  assert.equal(typeLabel('retirement.401k'), '401(k)');
  assert.equal(typeLabel('loans.student'), 'Student loans');
  assert.equal(typeLabel('cash.ebt'), 'Ebt');
  assert.equal(typeLabel('other.other'), 'Other assets');
  assert.deepEqual(partsOf(day('2026-10-31', 100, 40)), { 'cash.cash': 100, 'loans.loans': 40 });
  const days = [{ ...day('2026-10-30', 0), types: { 'credit.credit card': 50, 'cash.checking': 10 } }, { ...day('2026-10-31', 0), types: { 'cash.checking': 30 } }];
  assert.deepEqual(typesUsed(days), ['cash.checking', 'credit.credit card']);
});

test('look-backs, highs and lows come from the snapshots on record', () => {
  const values = [100, 300, 200, 250];
  const days = values.map((v, i) => day(addDays('2026-10-28', i), v));
  assert.deepEqual(changeOver(days, 1), { from: '2026-10-30', base: 200, change: 50 });
  assert.equal(changeOver(days, 30), null);
  assert.equal(changeOver(days, Infinity).change, 150);
  const p = Object.fromEntries(periods(days).map((r) => [r.label, r.change]));
  assert.deepEqual([p['1 day'], p['7 days'], p['All time']], [50, null, 150]);
  const r = records(days);
  assert.deepEqual([r.high.date, r.low.date, r.belowHigh, r.count], ['2026-10-29', '2026-10-28', -50, 4]);
});

test('money prints whole dollars with a true minus', () => {
  assert.equal(money(-14193), '−$14,193');
  assert.equal(signed(1240), '+$1,240');
  assert.equal(signed(0), '$0');
  assert.equal(compact(48312), '$48.3K');
});
