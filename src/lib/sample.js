// Sample figures for the page before the first real snapshot: fifteen months of a plausible early-career
// balance sheet (pay every other Friday, rent, a card paid in full, a student loan, a savings plan, a market
// slump in the sixth month), seeded so it is the same on every load, and ending today. The page labels it.
import { addDays } from './networth.js';

function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function localToday(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}

export function sampleHistory(end = localToday()) {
  const rand = random(20261031);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  let checking = 1700, savings = 1500, brokerage = 6000, k401 = 3000, roth = 1500, card = 0, student = 16900;
  const days = [];
  for (let i = 0, date = addDays(end, -455); date <= end; i++, date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const dom = +date.slice(8, 10);
    if (weekday > 0 && weekday < 6) {
      const r = (i > 180 && i < 205 ? -0.0045 : 0.00045) + 0.0085 * normal();
      brokerage *= 1 + r;
      k401 *= 1 + r;
      roth *= 1 + r;
    }
    if (weekday === 5 && i % 14 < 7) { checking += 1740; savings += 100; k401 += 290; } // payday, $100 of it to savings
    card += 22 + 30 * rand(); // everyday spending, on the card
    if (dom === 1) checking -= 1150; // rent
    if (dom === 8) { checking -= 260; student -= 195; } // student loan: the rest of the payment is interest
    if (dom === 2 || dom === 16) { checking -= 550; brokerage += 550; } // savings plan
    if (dom === 12) { checking -= 90; roth += 90; } // Roth IRA contribution
    if (dom === 22) { checking -= card; card = 0; } // card paid in full
    // Each type rounded, and each category the sum of its rounded types, so the parts match the whole.
    const types = Object.fromEntries(Object.entries({
      'cash.checking': checking, 'cash.savings': savings, 'investments.brokerage': brokerage, 'retirement.401k': k401,
      'retirement.roth': roth, 'credit.credit card': card, 'loans.student': student,
    }).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
    const total = (category) => Object.entries(types).reduce((s, [k, v]) => (k.startsWith(`${category}.`) ? s + v : s), 0);
    days.push({ date, cash: total('cash'), investments: total('investments'), retirement: total('retirement'), other: 0, credit: total('credit'), loans: total('loans'), types });
  }
  return { currency: 'USD', source: 'sample', updated: `${end}T10:00:00.000Z`, accounts: 7, days };
}
