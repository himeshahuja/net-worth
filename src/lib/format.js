// Money and dates as the page prints them: whole dollars, a true minus sign, dates without time zones.

export const MINUS = '−';
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export const money = (v) => (v < 0 ? MINUS : '') + usd.format(Math.abs(v));
export const signed = (v) => (v > 0 ? '+' : v < 0 ? MINUS : '') + usd.format(Math.abs(v));
export const compact = (v) => (v < 0 ? MINUS : '') + usdCompact.format(Math.abs(v));
// A share or a rate to one decimal: "31.4%", "−2.0%"; a change against a base of zero or less has no percentage.
export const percent = (v) => (v < 0 ? MINUS : '') + `${Math.abs(v * 100).toFixed(1)}%`;
export const signedPercent = (v) => (v > 0 ? '+' : '') + percent(v);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (date) => ({ y: +date.slice(0, 4), m: +date.slice(5, 7), d: +date.slice(8, 10) });

export const monthName = (date) => MONTHS[parts(date).m - 1];
export const shortMonth = (date) => monthName(date).slice(0, 3);
export const shortDate = (date) => `${shortMonth(date)} ${parts(date).d}`; // Oct 31
export const longDate = (date) => `${shortDate(date)}, ${parts(date).y}`; // Oct 31, 2026
export const monthYear = (date) => `${monthName(date)} ${parts(date).y}`; // October 2026

// A moment (an ISO timestamp), in the reader's own clock: "Oct 31, 2026 at 6:02 AM".
export function stamp(iso) {
  const at = new Date(iso);
  const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${day} at ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
