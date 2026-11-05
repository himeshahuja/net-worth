import { useCallback, useEffect, useRef, useState } from 'react';
import Bar from '../Bar.jsx';
import LineChart from '../charts/LineChart.jsx';
import ColumnChart from '../charts/ColumnChart.jsx';
import { CATEGORIES, addDays, categoryOfType, changeSince, dayOn, daysBetween, endOfLastMonth, endOfLastYear, milestones, months, net, own, owe, partsOf, periods, records, typeLabel, typesUsed } from '../lib/networth.js';
import { compact, longDate, money, monthYear, percent, shortDate, shortMonth, signed, signedPercent, stamp } from '../lib/format.js';
import { sampleHistory } from '../lib/sample.js';
import { isSealed, open } from '../lib/vault.js';
import { site } from '../site.js';

const DATA = `${import.meta.env.BASE_URL}networth.json`;

// The published history; the sample until there is one, or when the address ends in ?sample.
// The published file is sealed (see vault.js); one saved before that is plain.
async function loadHistory() {
  if (new URLSearchParams(location.search).has('sample')) return { history: sampleHistory() };
  try {
    const res = await fetch(DATA, { cache: 'no-cache' });
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      const file = await res.json();
      if (isSealed(file)) return { sealed: file };
      if (file.days?.length) return { history: file };
    }
  } catch {
    // not published yet, or offline
  }
  return { history: sampleHistory() };
}

// The key from the last opening, kept for this tab, or on this device when asked. It opens the next day's file too,
// as the salt stays the same until the password changes. Storage can be missing or blocked, so every use is guarded.
const KEY = 'net-worth-key';
function rememberedKey(file) {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const saved = JSON.parse(store.getItem(KEY));
      if (saved?.salt === file.kdf.salt) return saved.key;
    } catch {
      // nothing usable here
    }
  }
  return null;
}
function remember(file, key, onDevice) {
  try {
    (onDevice ? localStorage : sessionStorage).setItem(KEY, JSON.stringify({ salt: file.kdf.salt, key }));
  } catch {
    // the page still opens, it just asks again next time
  }
}
function forget() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.removeItem(KEY);
    } catch {
      // nothing to clear
    }
  }
}

// Google's sign-in script, loaded once and only on the lock screen.
let gis;
function loadGoogle() {
  gis ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('no google')));
    script.onerror = reject;
    document.head.append(script);
  });
  return gis;
}

// Trades Google's ID token for the key at the Worker, which checks the token and the address.
async function keyFromGoogle(credential) {
  const res = await fetch(site.google.unlock, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.key) throw new Error(body.error ?? 'unlock');
  return body.key;
}

const GOOGLE_ERRORS = {
  'not-allowed': 'That Google account can’t see these figures.',
  stale: 'Signed in, but the server’s key doesn’t open these figures.',
  failed: 'Sign-in didn’t go through. Try again.',
  unavailable: 'Google sign-in couldn’t load. Check the connection and reload.',
};

// Google draws its own button in the slot. The callback is read through a ref, so Google is set up once.
function GoogleSignIn({ onKey, onUnavailable }) {
  const slot = useRef(null);
  const latest = useRef(onKey);
  useEffect(() => {
    latest.current = onKey;
  }, [onKey]);
  useEffect(() => {
    let live = true;
    loadGoogle()
      .then((id) => {
        if (!live || !slot.current) return;
        id.initialize({ client_id: site.google.clientId, callback: ({ credential }) => latest.current(credential), ux_mode: 'popup', auto_select: false });
        id.renderButton(slot.current, { theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', width: slot.current.clientWidth });
      })
      .catch(() => live && onUnavailable());
    return () => {
      live = false;
    };
  }, [onUnavailable]);
  return <div ref={slot} className="google-slot" />;
}

// The only way in: Google sign-in, which the Worker trades for the key (see worker/).
function Lock({ file, onOpen }) {
  const [onDevice, setOnDevice] = useState(false);
  const [error, setError] = useState(null);
  const unavailable = useCallback(() => setError('unavailable'), []);
  const withGoogle = useCallback(
    async (credential) => {
      setError(null);
      let key;
      try {
        key = await keyFromGoogle(credential);
      } catch (err) {
        return setError(err.message === 'not-allowed' ? 'not-allowed' : 'failed');
      }
      try {
        const opened = await open(file, { key });
        remember(file, opened.key, onDevice);
        onOpen(opened.history);
      } catch {
        setError('stale');
      }
    },
    [file, onDevice, onOpen],
  );
  return (
    <section className="panel lock" aria-labelledby="lock-title">
      <h1 id="lock-title">Net worth</h1>
      <div className="lock-google">
        <GoogleSignIn onKey={withGoogle} onUnavailable={unavailable} />
        <p className="error-line" role="alert">{error ? GOOGLE_ERRORS[error] : ''}</p>
        <label className="check">
          <input type="checkbox" checked={onDevice} onChange={(e) => setOnDevice(e.target.checked)} /> Remember on this device
        </label>
      </div>
    </section>
  );
}

const SOURCE = { sample: 'Sample figures', sandbox: 'Sandbox figures' };
// The same day counts as the look-backs in periods(), so '1Y' and '1 year' start on the same snapshot.
const RANGES = [['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', Infinity]];
const SERIES = [
  { key: 'net', label: 'Net worth', value: net, better: 'up' },
  { key: 'own', label: 'Assets', value: own, better: 'up' },
  { key: 'owe', label: 'Liabilities', value: owe, better: 'down' },
];
const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// "Sep 30", or "Dec 31, 2025" when the date falls in another year than `to`.
const since = (from, to) => (from.slice(0, 4) === to.slice(0, 4) ? shortDate(from) : longDate(from));

function Triangle({ down }) {
  return (
    <svg className="triangle" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d={down ? 'M0 1.5h8L4 7.5z' : 'M0 6.5h8L4 0.5z'} />
    </svg>
  );
}

// A change, coloured for better or worse (less owed is better), never for up or down. Zero is grey; no change
// on record is a dash.
function Delta({ amount, better = 'up' }) {
  if (amount == null) return <span className="muted">—</span>;
  if (amount === 0) return <span className="muted">$0</span>;
  const tone = (better === 'up') === amount > 0 ? 'good' : 'bad';
  return <span className={tone}><Triangle down={amount < 0} /> {signed(amount)}</span>;
}

// A change as a share of where it started; meaningless from a figure of zero or below.
const share = (change, base) => (change != null && base > 0 ? signedPercent(change / base) : '—');

// The line under the title: the month's change, the screen's one finding.
function finding(days) {
  const last = days.at(-1);
  const month = changeSince(days, endOfLastMonth(last.date));
  if (!month) return null; // one snapshot so far: nothing has moved yet
  const way = month.net >= 0 ? 'Up' : 'Down';
  const from = month.started ? `since tracking began on ${since(month.from, last.date)}` : `since the ${since(month.from, last.date)} close`;
  const year = changeSince(days, endOfLastYear(last.date));
  const ytd = year && !year.started ? `, ${signed(year.net)} this year` : '';
  return `${way} ${money(Math.abs(month.net))} ${from}${ytd}.`;
}

function TitleRow({ history, ranges, range, onRange }) {
  const label = SOURCE[history.source];
  return (
    <div className="title-row">
      <div>
        <h1>Net worth</h1>
        <p className="finding">{finding(history.days)}</p>
      </div>
      <div className="title-side">
        <p className="stamp">
          {label && <span className="pill warn">{label}</span>}
          <span>{history.source === 'sample' ? `${history.accounts} sample accounts` : `${history.accounts} accounts via Plaid · updated ${stamp(history.updated)}`}</span>
        </p>
        {ranges.length > 1 && (
          <div className="segmented" role="group" aria-label="Range">
            {ranges.map(([key]) => <button key={key} type="button" aria-pressed={key === range} onClick={() => onRange(key)}>{key}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

// The figures as the chart's tabs: choosing one draws its line.
function Overview({ days, shown, base, series, onSeries }) {
  const last = days.at(-1);
  const current = SERIES.find((s) => s.key === series);
  const notes = series !== 'net' ? [] : milestones(days)
    .filter((m) => m.date > shown[0].date)
    .slice(-3)
    .map((m) => (m.value === 0 ? { date: m.date, label: 'Above zero', short: '$0' } : { date: m.date, label: `Passed ${money(m.value)}`, short: compact(m.value) }));
  return (
    <section className="panel overview" aria-labelledby="overview-title">
      <h2 id="overview-title" className="sr-only">Over time</h2>
      <div className="tabs" role="tablist" aria-label="Series">
        {SERIES.map((s, i) => (
          <button key={s.key} type="button" role="tab" aria-selected={s.key === series} className={i ? 'tab' : 'tab lead'} onClick={() => onSeries(s.key)}>
            <span className="tab-label">{s.label}</span>
            <span className="tab-value num">{money(s.value(last))}</span>
            <span className="tab-delta">
              <Delta amount={base ? s.value(last) - s.value(base) : null} better={s.better} />
              {base && <span className="muted"> since {since(base.date, last.date)}</span>}
            </span>
          </button>
        ))}
      </div>
      {shown.length > 1 ? (
        <LineChart
          key={series}
          points={shown.map((d) => ({ date: d.date, value: current.value(d) }))}
          notes={notes}
          height={248}
          tickFormat={compact}
          describe={`${current.label} from ${longDate(shown[0].date)}, ${money(current.value(shown[0]))}, to ${longDate(last.date)}, ${money(current.value(last))}`}
        />
      ) : (
        <p className="empty">The line starts with the next snapshot.</p>
      )}
      <Ratios day={last} />
    </section>
  );
}

// Every category and account type the history has held, with today's balance, its share of its side and its change
// over the range.
function BalanceSheet({ days, base, rangeLabel }) {
  const last = days.at(-1);
  const parts = partsOf(last), before = base?.types ? partsOf(base) : null;
  const types = typesUsed(days);
  const sides = [['own', 'Assets', own], ['owe', 'Liabilities', owe]];
  return (
    <section className="panel sheet" aria-labelledby="sheet-title">
      <header>
        <h2 id="sheet-title">Balance sheet</h2>
        {rangeLabel && <p className="meta">Change {rangeLabel}</p>}
      </header>
      <div className="table-wrap">
        <table>
          <Columns />
          <thead>
            <tr>
              <th scope="col">Account type</th>
              <th scope="col" className="n">Balance</th>
              <th scope="col" className="n wide">Share</th>
              <th scope="col" className="n">Change</th>
            </tr>
          </thead>
          {sides.map(([side, title, total]) => {
            const cats = CATEGORIES.filter((c) => c.side === side && days.some((d) => d[c.key]));
            const better = side === 'own' ? 'up' : 'down';
            return (
              <tbody key={side}>
                <tr className="side-row">
                  <th scope="rowgroup">{title}</th>
                  <td className="n num">{money(total(last))}</td>
                  <td className="n wide" />
                  <td className="n num"><Delta amount={base ? total(last) - total(base) : null} better={better} /></td>
                </tr>
                {cats.length === 0 && (
                  <tr><td colSpan={4} className="none">Nothing {side === 'own' ? 'held' : 'owed'}.</td></tr>
                )}
                {cats.flatMap((c) => {
                  const inner = types.filter((k) => categoryOfType(k) === c.key);
                  const split = inner.length > 1 || (inner[0] && typeLabel(inner[0]) !== c.label);
                  const row = (key, label, value, prev, kind) => (
                    <tr key={key} className={kind}>
                      <th scope="row">{label}</th>
                      <td className={value ? 'n num' : 'n num muted'}>{money(value)}</td>
                      <td className="n num muted wide">{total(last) > 0 ? percent(value / total(last)) : '—'}</td>
                      <td className="n num"><Delta amount={prev == null ? null : value - prev} better={better} /></td>
                    </tr>
                  );
                  return [
                    row(c.key, c.label, last[c.key], base ? base[c.key] || 0 : null, 'cat-row'),
                    ...(split ? inner.map((k) => row(k, typeLabel(k), parts[k] || 0, before ? before[k] || 0 : null, 'type-row')) : []),
                  ];
                })}
              </tbody>
            );
          })}
        </table>
        {/* The total sits at the card's foot when the card is stretched level with its neighbour, on the same columns. */}
        <table className="sheet-total">
          <Columns />
          <tbody>
            <tr>
              <th scope="row">Net worth</th>
              <td className="n num money">{money(net(last))}</td>
              <td className="n wide" />
              <td className="n num"><Delta amount={base ? net(last) - net(base) : null} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Columns() {
  return (
    <colgroup>
      <col />
      <col className="c-balance" />
      <col className="c-share wide" />
      <col className="c-change" />
    </colgroup>
  );
}

function Changes({ days }) {
  return (
    <section className="panel" aria-labelledby="changes-title">
      <header>
        <h2 id="changes-title">Changes</h2>
      </header>
      <ul className="kv">
        {periods(days).map((p) => (
          <li key={p.label}>
            <span>{p.label}</span>
            <span className="n num">
              <Delta amount={p.change} />
              {p.change != null && <small>{share(p.change, p.base)}</small>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Records({ days }) {
  const r = records(days);
  const end = days.at(-1).date;
  const rows = [
    ['Highest', money(net(r.high)), since(r.high.date, end)],
    ['Lowest', money(net(r.low)), since(r.low.date, end)],
    ['Below the high', r.belowHigh === 0 ? '$0' : money(r.belowHigh), ''],
    ['Best month', r.best ? signed(r.best.change) : '—', r.best ? monthYear(r.best.day.date) : ''],
    ['Worst month', r.worst ? signed(r.worst.change) : '—', r.worst ? monthYear(r.worst.day.date) : ''],
    ['On record', `${r.count} ${r.count === 1 ? 'day' : 'days'}`, longDate(r.since)],
  ];
  return (
    <section className="panel" aria-labelledby="records-title">
      <header>
        <h2 id="records-title">Records</h2>
      </header>
      <ul className="kv">
        {rows.map(([label, value, note]) => (
          <li key={label}>
            <span>{label}</span>
            <span className="n num">{value}{note && <small>{note}</small>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Today's shape, under the chart: one strip split by dividers.
function Ratios({ day }) {
  const assets = own(day);
  const of = (v) => (assets > 0 ? percent(v / assets) : '—');
  const rows = [
    ['Debt to assets', of(owe(day))],
    ['Cash', of(day.cash)],
    ['Invested', of(day.investments + day.retirement)],
    ['Liquid net worth', money(day.cash - day.credit)],
  ];
  return (
    <dl className="ratios" aria-label={`Ratios on ${longDate(day.date)}`}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="num">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Months({ days }) {
  const list = months(days);
  const [all, setAll] = useState(false);
  const current = days.at(-1).date.slice(0, 7);
  const cats = CATEGORIES.filter((c) => days.some((d) => d[c.key]));
  const bars = list.filter((m) => m.change != null).slice(0, 12).reverse()
    .map((m) => ({ key: m.month, label: shortMonth(m.day.date), title: `${monthYear(m.day.date)}${m.month === current ? ' to date' : ''}`, value: m.change, partial: m.month === current }));
  return (
    <section className="panel months" aria-labelledby="months-title">
      <header>
        <h2 id="months-title">Month by month</h2>
      </header>
      {bars.length > 1 && (
        <ColumnChart bars={bars} tickFormat={compact} describe={`Change in net worth per month, ${bars[0].title} to ${bars.at(-1).title}`} />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {cats.map((c) => <th key={c.key} scope="col" className="n wide">{c.label}</th>)}
              <th scope="col" className="n">Net worth</th>
              <th scope="col" className="n">Change</th>
            </tr>
          </thead>
          <tbody>
            {(all ? list : list.slice(0, 6)).map(({ month, day, change }) => (
              <tr key={month}>
                <th scope="row">
                  {monthYear(day.date)}
                  {month === current && <span className="muted"> to date</span>}
                  <span className="phone">Own {money(own(day))} · Owe {money(owe(day))}</span>
                </th>
                {cats.map((c) => <td key={c.key} className={day[c.key] ? 'n num wide' : 'n num wide muted'}>{CATEGORY[c.key].side === 'owe' && day[c.key] ? money(-day[c.key]) : money(day[c.key] || 0)}</td>)}
                <td className="n num">{money(net(day))}</td>
                <td className="n num">{change == null ? <span className="muted">—</span> : <Delta amount={change} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > 6 && (
        <button type="button" className="text-btn more" onClick={() => setAll(!all)}>
          {all ? 'Show the last 6 months' : `Show all ${list.length} months`}
        </button>
      )}
    </section>
  );
}

function Transactions({ transactions = [] }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const filtered = transactions.filter((transaction) => {
    const text = `${transaction.name} ${transaction.merchant || ''} ${transaction.category} ${transaction.accountName || ''}`.toLowerCase();
    return text.includes(query.toLowerCase().trim());
  });
  const shown = all ? filtered : filtered.slice(0, 25);
  return (
    <section className="panel transactions" aria-labelledby="transactions-title">
      <header>
        <h2 id="transactions-title">Transactions</h2>
        <span className="meta">{transactions.length} recorded</span>
      </header>
      {transactions.length === 0 ? <p className="empty">Transactions will appear after the next bank snapshot.</p> : (
        <>
          <label className="transaction-search">
            <span className="sr-only">Search transactions</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transactions" />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Category</th><th scope="col" className="n">Amount</th></tr>
              </thead>
              <tbody>
                {shown.map((transaction) => (
                  <tr key={transaction.id}>
                    <th scope="row">{shortDate(transaction.date)}</th>
                    <td>{transaction.name}{transaction.pending && <span className="muted"> · pending</span>}<span className="phone">{transaction.accountName || 'Account'}</span></td>
                    <td className="muted">{transaction.category}</td>
                    <td className={`n num ${transaction.amount > 0 ? 'bad' : 'good'}`}>{signed(-transaction.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 25 && <button type="button" className="text-btn more" onClick={() => setAll(!all)}>{all ? 'Show the first 25 transactions' : `Show all ${filtered.length} transactions`}</button>}
        </>
      )}
    </section>
  );
}

function Loading() {
  return (
    <div className="grid" aria-busy="true">
      <div className="panel overview"><div className="skeleton" style={{ height: 360 }} /></div>
      <div className="panel sheet"><div className="skeleton" style={{ height: 420 }} /></div>
      <div className="side"><div className="panel"><div className="skeleton" style={{ height: 420 }} /></div></div>
    </div>
  );
}

function Dashboard({ history }) {
  const { days } = history;
  const end = days.at(-1).date;
  const ranges = RANGES.filter(([key, length]) => key === 'All' || length < daysBetween(days[0].date, end));
  const [range, setRange] = useState(ranges.some(([key]) => key === '1Y') ? '1Y' : 'All');
  const [series, setSeries] = useState('net');
  const length = ranges.find(([key]) => key === range)?.[1] ?? Infinity;
  const from = length === Infinity ? days[0].date : addDays(end, -length);
  const shown = days.filter((d) => d.date >= from);
  const base = length === Infinity ? days[0] : dayOn(days, from) || days[0];
  const start = base === days.at(-1) ? null : base;
  const rangeLabel = start ? `since ${since(start.date, end)}` : null;
  return (
    <>
      <TitleRow history={history} ranges={ranges} range={range} onRange={setRange} />
      <div className="grid">
        <Overview days={days} shown={shown} base={start} series={series} onSeries={setSeries} />
        <BalanceSheet days={days} base={start} rangeLabel={rangeLabel} />
        <div className="side">
          <Changes days={days} />
          <Records days={days} />
        </div>
        <Months days={days} />
        <Transactions transactions={history.transactions} />
      </div>
    </>
  );
}

export default function NetWorth() {
  const [history, setHistory] = useState(null);
  const [sealed, setSealed] = useState(null);
  useEffect(() => {
    loadHistory().then(async (loaded) => {
      if (!loaded.sealed) return setHistory(loaded.history);
      const key = rememberedKey(loaded.sealed);
      if (key) {
        try {
          return setHistory((await open(loaded.sealed, { key })).history);
        } catch {
          forget();
        }
      }
      setSealed(loaded.sealed);
    });
  }, []);
  const lock = () => {
    forget();
    setHistory(null);
  };
  return (
    <>
      <Bar>
        {sealed && history && <button type="button" className="text-btn bar-btn" onClick={lock}>Lock</button>}
        <a href={site.portfolio}>Portfolio</a>
      </Bar>
      <main className="page">
        {history ? <Dashboard history={history} /> : sealed ? <Lock file={sealed} onOpen={setHistory} /> : (
          <>
            <div className="title-row"><div><h1>Net worth</h1><p className="finding">&nbsp;</p></div></div>
            <Loading />
          </>
        )}
      </main>
      <footer className="page page-foot">
        © {new Date().getFullYear()} {site.owner}
      </footer>
    </>
  );
}
