// Lokalt økonomi-dashboard. Ingen afhængigheder – kræver Node 20+.
// Start: node server.js  →  http://localhost:5180
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnv();
const store = require('./lib/store');
const { CATEGORIES, INTERNAL, PASSTHROUGH, REFUND, categorize, merchantKey, detectRecurring } = require('./lib/categorize');
const { parseBankCsv } = require('./lib/csv');
const eb = require('./lib/enablebanking');
const prices = require('./lib/prices');
const { subscriptions, computeAlerts } = require('./lib/alerts');
const notify = require('./lib/notify');
const demo = require('./lib/demo');


const PORT = Number(process.env.PORT || 5180);
const PUBLIC = path.join(__dirname, 'public');

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

// ---------- hjælpere ----------

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 30e6) { reject(new Error('For stor forespørgsel')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Ugyldig JSON')); }
    });
  });
}

function txHash(accountId, t, n) {
  return crypto.createHash('sha1').update(`${accountId}|${t.date}|${t.amount}|${t.text}|${n}`).digest('hex').slice(0, 16);
}

// Indsætter posteringer uden dubletter. Identiske posteringer samme dag tælles med løbenummer.
function insertTransactions(db, account, rows, source) {
  const existing = new Set(db.transactions.filter((t) => t.accountId === account.id).map((t) => t.id));
  const seen = new Map();
  let added = 0;
  for (const r of rows) {
    const base = `${r.date}|${r.amount}|${r.text}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const id = r.extId ? 'x' + crypto.createHash('sha1').update(account.id + r.extId).digest('hex').slice(0, 15) : txHash(account.id, r, n);
    if (existing.has(id)) {
      // Opdater en tidligere ventende postering, hvis den nu er bogført
      const old = db.transactions.find((t) => t.id === id);
      if (old && old.pending && !r.pending) old.pending = false;
      continue;
    }
    existing.add(id);
    db.transactions.push({
      id,
      accountId: account.id,
      date: r.date,
      text: r.text,
      amount: r.amount,
      balance: r.balance ?? null,
      category: categorize(r.text, r.amount, db.rules, r.date),
      source,
      pending: !!r.pending,
    });
    added++;
  }
  db.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return added;
}

// Finder overførsler mellem egne konti: samme beløb med modsat fortegn inden for 4 dage.
// Manuelt kategoriserede posteringer røres ikke.
function markInternalTransfers(db) {
  const DAY = 86400000;
  const free = db.transactions.filter((t) => !t.pending && !t.manual && t.category !== INTERNAL && t.category !== PASSTHROUGH);
  const credits = new Map();
  for (const t of free) if (t.amount > 0) {
    const k = t.amount.toFixed(2);
    if (!credits.has(k)) credits.set(k, []);
    credits.get(k).push(t);
  }
  let n = 0;
  for (const d of free) {
    if (d.amount >= 0 || d.category === INTERNAL) continue;
    const list = credits.get((-d.amount).toFixed(2)) || [];
    const i = list.findIndex((c) => c.category !== INTERNAL &&
      Math.abs(Date.parse(c.date) - Date.parse(d.date)) <= 4 * DAY &&
      (c.accountId !== d.accountId || merchantKey(c.text) === merchantKey(d.text)));
    if (i < 0) continue;
    const c = list.splice(i, 1)[0];
    c.category = d.category = INTERNAL;
    n++;
  }
  return n;
}

function ebStatus(db) {
  const c = eb.config();
  return {
    configured: c.configured,
    hasAppId: !!c.appId,
    hasKey: fs.existsSync(c.keyPath),
    keyPath: path.relative(__dirname, c.keyPath),
    redirectUrl: c.redirectUrl,
    connected: !!db.eb?.sessionId,
    bank: db.eb?.aspsp?.name || null,
    validUntil: db.eb?.validUntil || null,
    lastSync: db.eb?.lastSync || null,
    lastError: db.eb?.lastError || null,
  };
}

async function ebSync(db) {
  if (!db.eb?.sessionId) throw new Error('Ingen bank forbundet');
  const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  let added = 0;
  for (const acc of db.accounts.filter((a) => a.source === 'enablebanking' && a.ebUid)) {
    const bal = await eb.balances(acc.ebUid).catch(() => null);
    if (bal) { acc.balance = bal.amount; acc.balanceDate = bal.date || new Date().toISOString().slice(0, 10); }
    const txs = await eb.transactions(acc.ebUid, from);
    added += insertTransactions(db, acc, txs, 'enablebanking');
  }
  markInternalTransfers(db);
  db.eb.lastSync = new Date().toISOString();
  db.eb.lastError = null;
  store.save();
  return added;
}

async function ebFinish(db, code, state) {
  if (db.eb?.pendingState && state && state !== db.eb.pendingState) throw new Error('Ugyldig state – start forbindelsen igen');
  const s = await eb.createSession(code);
  db.eb = {
    sessionId: s.session_id,
    validUntil: s.access?.valid_until || null,
    aspsp: s.aspsp || db.eb?.aspsp,
    lastSync: null,
  };
  for (const a of s.accounts || []) {
    const uid = a.uid;
    const iban = a.account_id?.iban || a.account_id?.other?.identification || '';
    let acc = db.accounts.find((x) => x.ebUid === uid || (iban && x.iban === iban));
    if (!acc) {
      acc = { id: store.id(), name: a.product || a.details || `Konto ··${iban.slice(-4)}`, source: 'enablebanking', iban, currency: a.currency || 'DKK', balance: null, balanceDate: null };
      db.accounts.push(acc);
    }
    acc.source = 'enablebanking';
    acc.ebUid = uid;
  }
  store.save();
  return ebSync(db);
}

// ---------- API ----------

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/state', (req, db) => ({
  accounts: db.accounts,
  categories: CATEGORIES,
  rules: db.rules,
  fixed: db.fixed,
  assets: db.assets,
  holdings: db.holdings.map(holdingView),
  portfolioHistory: db.portfolioHistory,
  pricesUpdated: db.pricesUpdated || null,
  alerts: computeAlerts(db),
  notify: { ...notifySettings(db), canMac: notify.canMac(), emailConfigured: !!notify.mailConfig() },
  hasPriceKey: !!process.env.ALPHAVANTAGE_API_KEY,
  eb: ebStatus(db),
  hasDemo: db.transactions.some((t) => t.source === 'demo'),
}));

route('GET', '/api/transactions', (req, db) => db.transactions.map((t) => ({ ...t, key: (t.amount < 0 ? 'expense|' : 'income|') + merchantKey(t.text) })));

route('PATCH', '/api/transactions/:id', async (req, db, p) => {
  const body = await readBody(req);
  const tx = db.transactions.find((t) => t.id === p.id);
  if (!tx) throw Object.assign(new Error('Postering findes ikke'), { status: 404 });
  tx.category = body.category;
  tx.manual = true;
  let updated = 1;
  if (body.applyRule) {
    const key = merchantKey(tx.text);
    if (key.length >= 3) {
      const direction = tx.amount > 0 ? 'in' : 'out';
      db.rules = db.rules.filter((r) => !(r.match === key && (r.direction || direction) === direction));
      db.rules.unshift({ match: key, category: body.category, direction });
      for (const t of db.transactions) {
        if (t !== tx && (t.amount > 0) === (tx.amount > 0) && merchantKey(t.text).includes(key)) { t.category = body.category; updated++; }
      }
    }
  }
  store.save();
  return { updated };
});

route('POST', '/api/rules', async (req, db) => {
  const b = await readBody(req);
  if (!b.match || !b.category) throw new Error('match og category skal udfyldes');
  const rule = { match: String(b.match).toLowerCase(), category: b.category, ...(b.direction ? { direction: b.direction } : {}), ...(b.from ? { from: b.from } : {}), ...(b.to ? { to: b.to } : {}) };
  db.rules.splice(Number.isInteger(b.position) ? b.position : db.rules.length, 0, rule);
  store.save();
  return rule;
});

route('DELETE', '/api/rules/:i', (req, db, p) => {
  db.rules.splice(Number(p.i), 1);
  store.save();
  return { ok: true };
});

route('POST', '/api/recategorize', (req, db) => {
  for (const t of db.transactions) { t.category = categorize(t.text, t.amount, db.rules, t.date); delete t.manual; }
  markInternalTransfers(db);
  store.save();
  return { ok: true };
});

route('POST', '/api/import/csv', async (req, db) => {
  const body = await readBody(req);
  const parsed = parseBankCsv(body.text);
  let acc = db.accounts.find((a) => a.id === body.accountId);
  if (!acc) {
    acc = { id: store.id(), name: body.accountName || body.fileName || 'Bankkonto', source: 'csv', iban: '', currency: 'DKK', balance: null, balanceDate: null };
    db.accounts.push(acc);
  }
  const added = insertTransactions(db, acc, parsed.rows, 'csv');
  markInternalTransfers(db);
  // Saldo = saldo på seneste postering i filen (hvis filen har en saldokolonne)
  const withBal = parsed.rows.filter((r) => r.balance != null).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (withBal.length && (!acc.balanceDate || withBal[0].date >= acc.balanceDate)) {
    acc.balance = withBal[0].balance;
    acc.balanceDate = withBal[0].date;
  }
  store.save();
  return { account: acc, added, total: parsed.rows.length, skipped: parsed.rows.length - added };
});

route('PUT', '/api/accounts/:id', async (req, db, p) => {
  const body = await readBody(req);
  const acc = db.accounts.find((a) => a.id === p.id);
  if (!acc) throw Object.assign(new Error('Konto findes ikke'), { status: 404 });
  if (body.name != null) acc.name = body.name;
  if (body.balance != null) { acc.balance = Number(body.balance); acc.balanceDate = new Date().toISOString().slice(0, 10); }
  store.save();
  return acc;
});

route('DELETE', '/api/accounts/:id', (req, db, p) => {
  db.accounts = db.accounts.filter((a) => a.id !== p.id);
  db.transactions = db.transactions.filter((t) => t.accountId !== p.id);
  store.save();
  return { ok: true };
});

// ---------- Abonnementer og alarmer ----------
const notifySettings = (db) => ({ mac: true, email: true, ...(db.settings?.notify || {}) });

// Sender notifikation om alarmer, der ikke er sendt før. Kører ved start, hver time og efter bank-sync.
async function checkAlerts(db) {
  const state = (db.alertState = db.alertState || {});
  const fresh = computeAlerts(db).filter((a) => !state[a.key]);
  if (!fresh.length) return;
  const res = await notify.notifyAlerts(fresh, notifySettings(db));
  for (const a of fresh) state[a.key] = { notifiedAt: new Date().toISOString(), via: [res.mac && 'mac', res.email && 'mail'].filter(Boolean) };
  // Ryd op i gamle alarmer (ældre end et år)
  for (const [k, v] of Object.entries(state)) if (Date.now() - Date.parse(v.notifiedAt || v.dismissedAt || 0) > 400 * 86400000) delete state[k];
  store.save();
  if (res.errors?.length) console.error('Notifikation:', res.errors.join('; '));
}

route('GET', '/api/subscriptions', (req, db) => subscriptions(db));
route('POST', '/api/subscriptions/hide', async (req, db) => {
  const { key, hidden } = await readBody(req);
  db.hiddenSubs = (db.hiddenSubs || []).filter((k) => k !== key);
  if (hidden) db.hiddenSubs.push(key);
  store.save();
  return { ok: true };
});
route('POST', '/api/alerts/dismiss', async (req, db) => {
  const { key } = await readBody(req);
  db.alertState = db.alertState || {};
  db.alertState[key] = { ...(db.alertState[key] || {}), dismissed: true, dismissedAt: new Date().toISOString() };
  store.save();
  return { ok: true };
});
route('PUT', '/api/settings/notify', async (req, db) => {
  const b = await readBody(req);
  db.settings = db.settings || {};
  db.settings.notify = { mac: b.mac !== false, email: b.email !== false };
  store.save();
  return db.settings.notify;
});
route('POST', '/api/alerts/test', async (req) => {
  const { channel } = await readBody(req);
  const title = 'Testnotifikation';
  const message = 'Sådan ser en alarm fra dit økonomi-dashboard ud.';
  if (channel === 'email') await notify.sendMail({ subject: 'Test fra Min økonomi', text: `${message}

Alarmer sendes hertil, når fx husleje mangler eller en regning ikke er trukket.
` });
  else await notify.macNotify(title, message);
  return { ok: true };
});

// Faste poster
route('GET', '/api/recurring', (req, db) => {
  const fixedKeys = new Set(db.fixed.map((f) => f.key).filter(Boolean));
  const hidden = new Set(db.hiddenRecurring);
  return detectRecurring(db.transactions).map((r) => ({ ...r, status: fixedKeys.has(r.key) ? 'fixed' : hidden.has(r.key) ? 'hidden' : 'new' }));
});
route('POST', '/api/recurring/hide', async (req, db) => {
  const { key } = await readBody(req);
  if (key && !db.hiddenRecurring.includes(key)) db.hiddenRecurring.push(key);
  store.save();
  return { ok: true };
});
crud('fixed', ['name', 'key', 'amount', 'interval', 'category', 'kind', 'dueDay', 'until']);

// Aktiver (lejlighed, kunst, depot …). Hver værdiændring gemmes i historikken.
route('POST', '/api/assets', async (req, db) => {
  const b = await readBody(req);
  const a = { id: store.id(), ...pickAsset(b), history: [] };
  if (a.loan) a.debt = a.loan.principal;
  a.history.push({ date: b.date || today(), value: a.value, debt: a.debt });
  db.assets.push(a);
  store.save();
  return a;
});
route('PUT', '/api/assets/:id', async (req, db, p) => {
  const b = await readBody(req);
  const a = db.assets.find((x) => x.id === p.id);
  if (!a) throw Object.assign(new Error('Aktiv findes ikke'), { status: 404 });
  const next = pickAsset({ ...a, ...b, loan: b.loan === undefined ? a.loan : b.loan });
  if (next.loan) next.debt = next.loan.principal;
  if (b.loan === null) delete a.loan;
  const changed = next.value !== a.value || next.debt !== a.debt;
  Object.assign(a, next);
  if (changed) {
    const date = b.date || today();
    a.history = a.history.filter((h) => h.date !== date);
    a.history.push({ date, value: a.value, debt: a.debt });
    a.history.sort((x, y) => (x.date < y.date ? -1 : 1));
  }
  store.save();
  return a;
});
route('DELETE', '/api/assets/:id', (req, db, p) => {
  db.assets = db.assets.filter((x) => x.id !== p.id);
  store.save();
  return { ok: true };
});

function pickAsset(b) {
  return {
    name: String(b.name || 'Aktiv'),
    type: b.type || 'andet',
    value: Number(b.value) || 0,
    debt: Number(b.debt) || 0,
    expectedReturn: b.expectedReturn === '' || b.expectedReturn == null ? null : Number(b.expectedReturn),
    note: b.note || '',
    ...(b.loan ? { loan: pickLoan(b.loan) } : {}),
  };
}

// Realkreditlån knyttet til en bolig. Gælden på aktivet følger lånets restgæld.
function pickLoan(l) {
  const num = (x, d = 0) => (x === '' || x == null || isNaN(Number(x)) ? d : Number(x));
  return {
    lender: String(l.lender || ''),
    principal: num(l.principal),
    balanceDate: l.balanceDate || today(),
    rate: num(l.rate),
    bidragPerTerm: num(l.bidragPerTerm),
    termsPerYear: num(l.termsPerYear, 4),
    endDate: l.endDate || null,
    ioUntil: l.ioUntil || null,
    nextTerm: l.nextTerm || null,
    taxDeduction: num(l.taxDeduction, 25),
    fixed: l.fixed !== false,
  };
}

// ---------- Portefølje ----------
// Beholdninger med antal og evt. købspris. Kursen hentes fra Alpha Vantage – eller man taster den selv,
// fx for danske investeringsforeninger, som Alpha Vantage ikke kender.
const numOrNull = (x) => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));
const fxCurrency = (c) => (c === 'GBX' ? 'GBP' : c); // London-kurser er i pence

function pickHolding(b, old = {}) {
  const get = (k) => (b[k] !== undefined ? b[k] : old[k]);
  const ticker = String(get('ticker') || '').trim().toUpperCase();
  return {
    name: String(get('name') || '').trim() || ticker || 'Beholdning',
    ticker,
    quantity: numOrNull(get('quantity')) ?? 0,
    cost: numOrNull(get('cost')),               // købt for i alt (kr.)
    currency: String(get('currency') || (ticker ? prices.guessCurrency(ticker) : 'DKK')).toUpperCase(),
    account: String(get('account') || ''),
    manualPrice: numOrNull(get('manualPrice')), // egen kurs i beholdningens valuta
  };
}

function holdingView(h) {
  const price = h.manualPrice ?? h.lastPrice ?? null;
  const rate = h.currency === 'DKK' ? 1 : h.fx;
  const value = price != null && rate ? h.quantity * price * (h.currency === 'GBX' ? 0.01 : 1) * rate : null;
  return { ...h, price, priceSource: h.manualPrice != null ? 'manual' : h.lastPrice != null ? 'alphavantage' : null, value, gain: value != null && h.cost ? value - h.cost : null };
}

// Gemmer dagens samlede værdi, så udviklingen kan vises over tid (én måling pr. dag)
function snapshotPortfolio(db) {
  const views = db.holdings.map(holdingView).filter((h) => h.value != null);
  const point = { date: today(), value: Math.round(sum(views, (h) => h.value)), cost: Math.round(sum(views, (h) => h.cost || 0)) };
  db.portfolioHistory = db.portfolioHistory.filter((p) => p.date !== point.date);
  if (db.holdings.length) db.portfolioHistory.push(point);
  db.portfolioHistory.sort((a, b) => (a.date < b.date ? -1 : 1));
}
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

async function refreshPrices(db, force = false) {
  const errors = new Set();
  let stop = false;
  for (const h of db.holdings) {
    if (stop || !h.ticker || h.manualPrice != null) continue;
    try {
      const q = await prices.quote(h.ticker, force);
      Object.assign(h, { lastPrice: q.price, priceDate: q.date, changePct: q.changePct });
    } catch (e) {
      errors.add(e.code ? e.message : `${h.name}: ${e.message}`);
      if (e.code) stop = true; // manglende nøgle eller opbrugt kvote – resten fejler også
    }
  }
  for (const cur of new Set(db.holdings.map((h) => fxCurrency(h.currency)))) {
    if (cur === 'DKK' || stop) continue;
    try {
      const rate = await prices.fxToDKK(cur, force);
      for (const h of db.holdings) if (fxCurrency(h.currency) === cur) h.fx = rate;
    } catch (e) {
      errors.add(e.code ? e.message : `Valutakurs ${cur}: ${e.message}`);
      if (e.code) stop = true;
    }
  }
  db.pricesUpdated = new Date().toISOString();
  snapshotPortfolio(db);
  store.save();
  return [...errors];
}

const holdingsResult = async (db) => ({ errors: await refreshPrices(db), holdings: db.holdings.map(holdingView) });

route('POST', '/api/holdings', async (req, db) => {
  const h = { id: store.id(), ...pickHolding(await readBody(req)) };
  if (h.manualPrice != null) h.manualDate = today();
  db.holdings.push(h);
  return holdingsResult(db);
});
route('PUT', '/api/holdings/:id', async (req, db, p) => {
  const h = db.holdings.find((x) => x.id === p.id);
  if (!h) throw Object.assign(new Error('Findes ikke'), { status: 404 });
  const next = pickHolding(await readBody(req), h);
  if (next.ticker !== h.ticker) Object.assign(h, { lastPrice: null, priceDate: null, changePct: null });
  if (next.currency !== h.currency) h.fx = null;
  if (next.manualPrice !== h.manualPrice) h.manualDate = next.manualPrice != null ? today() : null;
  Object.assign(h, next);
  return holdingsResult(db);
});
route('DELETE', '/api/holdings/:id', (req, db, p) => {
  db.holdings = db.holdings.filter((x) => x.id !== p.id);
  snapshotPortfolio(db);
  store.save();
  return { ok: true };
});
route('POST', '/api/holdings/refresh', async (req, db) => {
  const b = await readBody(req);
  return { errors: await refreshPrices(db, !!b.force), holdings: db.holdings.map(holdingView) };
});
route('GET', '/api/search', async (req) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  return q.length < 2 ? [] : prices.search(q);
});

// Enable Banking
route('GET', '/api/eb/status', (req, db) => ebStatus(db));
route('GET', '/api/eb/banks', async () => eb.listBanks('DK'));
route('POST', '/api/eb/start', async (req, db) => {
  const { bank } = await readBody(req);
  const state = crypto.randomBytes(12).toString('hex');
  const url = await eb.startAuth(bank, 'DK', state);
  db.eb = { ...(db.eb || {}), pendingState: state, aspsp: { name: bank, country: 'DK' } };
  store.save();
  return { url };
});
route('POST', '/api/eb/code', async (req, db) => {
  const { input } = await readBody(req);
  let code = String(input || '').trim();
  let state = null;
  if (code.includes('code=')) {
    const u = new URL(code.startsWith('http') ? code : 'http://x/?' + code.split('?').pop());
    code = u.searchParams.get('code');
    state = u.searchParams.get('state');
  }
  if (!code) throw new Error('Fandt ingen kode i det indsatte');
  return { added: await ebFinish(db, code, state) };
});
route('POST', '/api/eb/sync', async (req, db) => ({ added: await ebSync(db) }));
route('DELETE', '/api/eb', (req, db) => {
  db.eb = null;
  for (const a of db.accounts) if (a.source === 'enablebanking') { a.source = 'csv'; delete a.ebUid; }
  store.save();
  return { ok: true };
});

// Demodata til at prøve dashboardet uden egne tal
route('POST', '/api/demo', (req, db) => {
  demo.load(db, store, insertTransactions);
  store.save();
  return { ok: true };
});
route('DELETE', '/api/demo', (req, db) => {
  demo.clear(db);
  store.save();
  return { ok: true };
});

function crud(name, fields) {
  const pick = (b) => Object.fromEntries(fields.filter((f) => f in b).map((f) => [f, b[f]]));
  route('POST', `/api/${name}`, async (req, db) => {
    const item = { id: store.id(), ...pick(await readBody(req)) };
    db[name].push(item);
    store.save();
    return item;
  });
  route('PUT', `/api/${name}/:id`, async (req, db, p) => {
    const item = db[name].find((x) => x.id === p.id);
    if (!item) throw Object.assign(new Error('Findes ikke'), { status: 404 });
    Object.assign(item, pick(await readBody(req)));
    store.save();
    return item;
  });
  route('DELETE', `/api/${name}/:id`, (req, db, p) => {
    db[name] = db[name].filter((x) => x.id !== p.id);
    store.save();
    return { ok: true };
  });
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------- server ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const db = store.load();

  // Bankens redirect efter MitID-godkendelse
  if (url.pathname === '/api/eb/callback') {
    try {
      const err = url.searchParams.get('error');
      if (err) throw new Error(url.searchParams.get('error_description') || err);
      await ebFinish(db, url.searchParams.get('code'), url.searchParams.get('state'));
      res.writeHead(302, { Location: '/#indstillinger?bank=ok' });
    } catch (e) {
      if (db.eb) { db.eb.lastError = e.message; store.save(); }
      res.writeHead(302, { Location: '/#indstillinger?bank=fejl' });
    }
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re);
      if (!m) continue;
      try {
        return send(res, 200, await r.fn(req, db, m.groups || {}));
      } catch (e) {
        console.error(req.method, url.pathname, e.message);
        return send(res, e.status || 400, { error: e.message });
      }
    }
    return send(res, 404, { error: 'Ukendt endpoint' });
  }

  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Ikke fundet'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// Flytter ældre indbetalinger, som nu genkendes som tilbagebetalinger (MobilePay, udlæg), til den nye kategori.
// Manuelt kategoriserede og interne overførsler røres ikke.
function migrateRefunds(db) {
  let n = 0;
  for (const t of db.transactions) {
    if (t.manual || t.amount <= 0 || t.category === REFUND || t.category === INTERNAL || t.category === PASSTHROUGH) continue;
    if (categorize(t.text, t.amount, db.rules, t.date) === REFUND) { t.category = REFUND; n++; }
  }
  if (n) { store.save(); console.log(`${n} indbetalinger flyttet til "${REFUND}"`); }
}

// Kun tilgængelig fra denne maskine
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Økonomi-dashboard kører på http://localhost:${PORT}`);
  migrateRefunds(store.load());
  autoSync();
  setTimeout(() => checkAlerts(store.load()).catch((e) => console.error('Alarmer:', e.message)), 5000);
  setInterval(() => checkAlerts(store.load()).catch((e) => console.error('Alarmer:', e.message)), 3600 * 1000);
  // PSD2 tillader ca. 4 automatiske hentninger i døgnet uden at du er til stede
  setInterval(autoSync, 6 * 3600 * 1000);
});

function autoSync() {
  const db = store.load();
  // Kurser højst to gange i døgnet (svarene gemmes i 12 timer), så porteføljens historik får én måling pr. dag
  if (db.holdings.length && (!db.pricesUpdated || Date.now() - Date.parse(db.pricesUpdated) > 12 * 3600 * 1000)) {
    refreshPrices(db).then((errs) => errs.length && console.error('Kurser:', errs.join('; '))).catch((e) => console.error('Kurser:', e.message));
  }
  if (!db.eb?.sessionId || !eb.config().configured) return;
  // Bankerne tillader kun få hentninger i døgnet uden at du er til stede – spring over hvis nyligt hentet
  if (db.eb.lastSync && Date.now() - Date.parse(db.eb.lastSync) < 5.5 * 3600 * 1000) return;
  ebSync(db)
    .then((n) => { console.log(`Bank synkroniseret: ${n} nye posteringer`); return checkAlerts(db); })
    .catch((e) => { db.eb.lastError = e.message; store.save(); console.error('Bank-sync fejlede:', e.message); });
}
