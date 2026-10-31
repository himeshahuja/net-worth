import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import Bar from '../Bar.jsx';
import { CATEGORIES, net, typeLabel } from '../lib/networth.js';
import { longDate, money, stamp } from '../lib/format.js';

// What the owner is connecting decides which Plaid product Link asks for (see server/api.js).
const KINDS = [
  { key: 'bank', label: 'Bank or credit card' },
  { key: 'investment', label: 'Investments or retirement' },
  { key: 'loan', label: 'Loan' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));
const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const cents = (v) => (v < 0 ? '−' : '') + exact.format(Math.abs(v));

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Requested-By': 'net-worth' },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `The request failed (${res.status}).`), data);
  return data;
}

// Plaid Link for one link token: it opens as soon as its script has loaded and unmounts when Link closes.
function PlaidLink({ token, onSuccess, onExit }) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}

function ConnectMenu({ primary, busy, onPick }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !wrap.current.contains(event.target))) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className={primary ? 'btn primary' : 'btn'} aria-expanded={open} aria-haspopup="menu" disabled={busy} onClick={() => setOpen(!open)}>
        {busy ? 'Opening Plaid…' : 'Connect an account'}
      </button>
      {open && (
        <div className="menu" role="menu">
          {KINDS.map((k) => (
            <button type="button" role="menuitem" key={k.key} onClick={() => { setOpen(false); onPick(k.key); }}>
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Setup() {
  return (
    <section className="panel setup">
      <header>
        <h2>Add your Plaid keys</h2>
      </header>
      <ol className="steps">
        <li>
          Sign up at <a href="https://dashboard.plaid.com/signup">dashboard.plaid.com</a>. The free Trial plan connects up to
          10 real accounts; the sandbox connects test banks without limit.
        </li>
        <li>
          Copy <code>.env.example</code> to <code>.env</code> in this folder and paste in your client ID and the secret for
          the environment you choose. <code>.env</code> never leaves this computer.
        </li>
        <li>Come back here. The page reads the keys as soon as they are saved.</li>
      </ol>
    </section>
  );
}

function Connection({ connection: c, busy, confirming, onReconnect, onAskRemove, onRemove, onCancel }) {
  const needsLogin = c.error?.code === 'ITEM_LOGIN_REQUIRED' || c.error?.code === 'PENDING_EXPIRATION';
  return (
    <article className="connection">
      <div className="connection-head">
        <div>
          <h3>{c.institution}</h3>
          <p className="sub">{KIND_LABEL[c.kind]} · added {longDate(c.added.slice(0, 10))}</p>
        </div>
        {c.error ? <span className={needsLogin ? 'pill warn' : 'pill bad'}>{needsLogin ? 'Needs sign-in' : 'Not answering'}</span> : <span className="pill good">Connected</span>}
        <div className="actions">
          {confirming ? (
            <>
              <button type="button" className="btn small" onClick={onCancel}>Keep</button>
              <button type="button" className="btn small danger" disabled={busy} onClick={onRemove}>Remove {c.institution}</button>
            </>
          ) : (
            <>
              {needsLogin && <button type="button" className="btn small" disabled={busy} onClick={onReconnect}>Reconnect</button>}
              <button type="button" className="text-btn" onClick={onAskRemove}>Remove</button>
            </>
          )}
        </div>
      </div>
      {confirming && <p className="confirm">Disconnects {c.institution} at Plaid. It doesn’t free up a Trial plan connection.</p>}
      {c.error && <p className="error-line">{c.error.message || c.error.code}</p>}
      {c.accounts.length > 0 && (
        <table className="accounts">
          <tbody>
            {c.accounts.map((a) => (
              <tr key={a.id}>
                <th scope="row">
                  {a.name}
                  {a.mask && <span className="muted"> ••{a.mask}</span>}
                </th>
                <td className="muted">{a.counts ? [...new Set([typeLabel(a.type), CATEGORY[a.category]])].join(" · ") : 'Not counted: no US dollar balance'}</td>
                <td className="n">{a.balance == null ? <span className="muted">—</span> : cents(a.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

function Snapshot({ status, busy, onSave }) {
  const { preview, history, connections, passwordProblem } = status;
  const blocked = connections.length === 0 ? 'Connect an account first.' : !preview ? 'Fix the connections marked above first.' : passwordProblem;
  const day = preview && { date: '', ...preview.totals };
  return (
    <section className="panel snapshot">
      <header>
        <h2>Today’s snapshot</h2>
      </header>
      {day ? (
        <dl className="totals">
          {CATEGORIES.filter((c) => day[c.key]).map((c) => (
            <div key={c.key}>
              <dt>{c.label}</dt>
              <dd className="num">{money(c.side === 'owe' ? -day[c.key] : day[c.key])}</dd>
            </div>
          ))}
          <div className="sum">
            <dt>Net worth</dt>
            <dd className="num">{money(net(day))}</dd>
          </div>
        </dl>
      ) : (
        <p className="empty">{blocked}</p>
      )}
      {day && passwordProblem && <p className="error-line">{passwordProblem}</p>}
      <button type="button" className={connections.length ? 'btn primary wide-btn' : 'btn wide-btn'} disabled={Boolean(blocked) || busy} onClick={onSave}>
        {busy ? 'Saving…' : 'Save today’s snapshot'}
      </button>
      <p className="meta">
        {history
          ? `Last saved ${stamp(history.updated)}, ${history.count} ${history.count === 1 ? 'day' : 'days'} on record${history.source === 'production' ? '' : ` (${history.source})`}.`
          : 'Nothing saved yet.'}
      </p>
    </section>
  );
}

export default function Admin() {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(() => api('GET', '/status').then(
    (next) => {
      setStatus(next);
      setLoadError(null);
    },
    (err) => setLoadError(err.message),
  ), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (what, task) => {
    setBusy(what);
    setMessage(null);
    try {
      setMessage({ tone: 'good', text: await task() });
    } catch (err) {
      const failures = err.failures?.map((f) => `${f.institution}: ${f.message || f.code}`).join(' ');
      setMessage({ tone: 'bad', text: failures ? `Nothing was saved. ${failures}` : err.message });
    }
    setBusy(null);
    refresh();
  };

  const openLink = async (request) => {
    setBusy('link');
    setMessage(null);
    try {
      const { linkToken } = await api('POST', '/link-token', request);
      setLink({ ...request, token: linkToken });
    } catch (err) {
      setMessage({ tone: 'bad', text: err.message });
      setBusy(null);
    }
  };
  const linked = (request) => (publicToken, metadata) => {
    setLink(null);
    run('link', async () => {
      if (!request.kind) return 'Signed in again.';
      await api('POST', '/items', { publicToken, institution: metadata.institution, kind: request.kind, linkSessionId: metadata.link_session_id });
      return `Connected ${metadata.institution?.name || 'the account'}.`;
    });
  };
  // Closing Link without an error is the owner changing their mind. An error is said, and its session ID goes to
  // the console, as it is what Plaid support asks for.
  const closed = (error, metadata) => {
    setLink(null);
    setBusy(null);
    if (!error) return;
    console.warn('Plaid Link closed with an error', { code: error.error_code, linkSessionId: metadata?.link_session_id, requestId: metadata?.request_id });
    setMessage({ tone: 'bad', text: error.display_message || error.error_message || `Plaid closed with an error (${error.error_code}).` });
  };

  return (
    <>
      <Bar>
        <a href="/">Public page</a>
      </Bar>
      <main className="page">
        <div className="title-row">
          <div>
            <h1>Connections</h1>
            <p className="source">{status ? `Plaid ${status.mode}` : ' '}</p>
          </div>
          {status?.ready && <ConnectMenu primary={status.connections.length === 0} busy={busy === 'link'} onPick={(kind) => openLink({ kind })} />}
        </div>
        {message && <p className={`message ${message.tone}`} role="status">{message.text}</p>}
        {loadError && <p className="message bad" role="alert">Couldn’t reach the local server: {loadError}</p>}
        {status && !status.ready && <div className="grid"><Setup /></div>}
        {status?.ready && (
          <div className="grid">
            <section className="panel banks">
              <header>
                <h2>Accounts</h2>
                <p className="meta">
                  {status.connections.length} {status.connections.length === 1 ? 'connection' : 'connections'}
                </p>
              </header>
              {status.connections.length ? (
                status.connections.map((c) => (
                  <Connection
                    key={c.id}
                    connection={c}
                    busy={Boolean(busy)}
                    confirming={confirming === c.id}
                    onReconnect={() => openLink({ itemId: c.id })}
                    onAskRemove={() => setConfirming(c.id)}
                    onCancel={() => setConfirming(null)}
                    onRemove={() => run(c.id, async () => {
                      await api('DELETE', `/items/${c.id}`);
                      setConfirming(null);
                      return `Removed ${c.institution}.`;
                    })}
                  />
                ))
              ) : (
                <p className="empty">No accounts yet. Connect a bank, a brokerage or a loan, and its balances appear here.</p>
              )}
            </section>
            <div className="side admin-side">
              <Snapshot
                status={status}
                busy={busy === 'snapshot'}
                onSave={() => run('snapshot', async () => {
                  const saved = await api('POST', '/snapshot');
                  const skipped = saved.skipped ? ` ${saved.skipped} without a US dollar balance left out.` : '';
                  return `Saved ${longDate(saved.day.date)}: net worth ${money(net(saved.day))} across ${saved.accounts} accounts.${skipped}`;
                })}
              />
            </div>
          </div>
        )}
        {link && <PlaidLink token={link.token} onSuccess={linked(link)} onExit={closed} />}
      </main>
    </>
  );
}
