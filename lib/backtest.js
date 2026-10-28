// Historisk backtest af porteføljer på månedsdata. Alle kurser omregnes til DKK.
// Kilder: Alpha Vantage (officielt API, gratis nøgle i .env), egne uploadede kursserier ("EGEN:id")
// og "FAST:x" = syntetisk aktiv med x % fast årligt afkast (fx lejlighed/kunst uden kurs).
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'prices');
const TTL = 3 * 86400 * 1000; // månedsdata ændrer sig langsomt; gratisnøglen har 25 kald/døgn
let custom = () => [];

function setCustomSource(fn) { custom = fn; }

async function cached(key, fn) {
  const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9._-]/gi, '_') + '.json');
  try {
    const hit = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - hit.t < TTL) return hit.v;
  } catch {}
  const v = await fn();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ t: Date.now(), v }));
  return v;
}

// Gratisnøglen tillader ca. 1 kald i sekundet, så kald sendes ét ad gangen
let queue = Promise.resolve();
function av(params) {
  const job = queue.then(() => avNow(params));
  queue = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1200)));
  return job;
}

async function avNow(params) {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) throw Object.assign(new Error('Mangler ALPHAVANTAGE_API_KEY i .env (gratis nøgle: alphavantage.co/support/#api-key)'), { code: 'NOKEY' });
  const res = await fetch('https://www.alphavantage.co/query?' + new URLSearchParams({ ...params, apikey: key }));
  if (!res.ok) throw new Error(`Alpha Vantage svarede HTTP ${res.status}`);
  const json = await res.json();
  if (json['Error Message']) throw new Error(`Ukendt symbol: ${params.symbol || params.keywords || ''}`);
  const note = json.Note || json.Information;
  if (note) {
    console.error('Alpha Vantage:', note);
    if (/per day|daily/i.test(note)) throw new Error('Alpha Vantage: dagens gratis-kvote er brugt op (25 kald/døgn). Hentede kurser gemmes i 3 dage.');
    if (/premium/i.test(note)) throw new Error(`Alpha Vantage: ${params.symbol || ''} kræver et betalt abonnement`);
    throw new Error('Alpha Vantage: for mange kald på kort tid – prøv igen om et øjeblik');
  }
  return json;
}

// Valuta ud fra børs-suffiks (Alpha Vantage oplyser ikke valuta i kursdata)
const SUFFIX_CCY = { LON: 'GBX', DEX: 'EUR', FRK: 'EUR', AMS: 'EUR', PAR: 'EUR', MIL: 'EUR', BRU: 'EUR', LIS: 'EUR', MAD: 'EUR', HEL: 'EUR', CPH: 'DKK', STO: 'SEK', OSL: 'NOK', SWX: 'CHF', TRT: 'CAD', TRV: 'CAD', HKG: 'HKD', SHH: 'CNY', SHZ: 'CNY', BSE: 'INR', NSE: 'INR' };
const guessCurrency = (sym) => SUFFIX_CCY[(sym.split('.')[1] || '').toUpperCase()] || 'USD';

async function avMonthly(symbol) {
  return cached('av_' + symbol, async () => {
    const json = await av({ function: 'TIME_SERIES_MONTHLY_ADJUSTED', symbol });
    const ts = json['Monthly Adjusted Time Series'] || {};
    const series = {};
    for (const [d, v] of Object.entries(ts)) series[d.slice(0, 7)] = Number(v['5. adjusted close']);
    if (!Object.keys(series).length) throw new Error(`Ingen kursdata for ${symbol}`);
    return series;
  });
}

async function fxMonthly(from) {
  return cached('fx_' + from + 'DKK', async () => {
    const json = await av({ function: 'FX_MONTHLY', from_symbol: from, to_symbol: 'DKK' });
    const ts = json['Time Series FX (Monthly)'] || {};
    const series = {};
    for (const [d, v] of Object.entries(ts)) series[d.slice(0, 7)] = Number(v['4. close']);
    return series;
  });
}

// Henter en kursserie som Map(måned → kurs i DKK)
async function inDKK(ticker, currencyHint) {
  let raw, cur, name;
  if (/^EGEN:/i.test(ticker)) {
    const c = custom().find((x) => 'EGEN:' + x.id === ticker);
    if (!c) throw new Error(`Egen kursserie ${ticker} findes ikke`);
    raw = c.series; cur = c.currency || 'DKK'; name = c.name;
  } else {
    raw = await avMonthly(ticker); cur = currencyHint || guessCurrency(ticker); name = ticker;
  }
  let factor = 1;
  if (cur === 'GBX' || cur === 'GBp') { cur = 'GBP'; factor = 0.01; }
  const fx = cur === 'DKK' ? null : await fxMonthly(cur);
  const series = new Map();
  for (const [m, p] of Object.entries(raw)) {
    const r = fx ? fx[m] : 1;
    if (r && p > 0) series.set(m, p * factor * r);
  }
  return { symbol: ticker, currency: cur, name, series };
}

async function search(q) {
  return cached('search_' + q.toLowerCase(), async () => {
    const json = await av({ function: 'SYMBOL_SEARCH', keywords: q });
    return (json.bestMatches || []).map((x) => ({
      symbol: x['1. symbol'], name: x['2. name'], type: x['3. type'], exchange: x['4. region'], currency: x['8. currency'],
    }));
  });
}

const isFixed = (t) => /^FAST:-?\d+(\.\d+)?$/i.test(t);
const fixedRate = (t) => Math.pow(1 + Number(t.split(':')[1]) / 100, 1 / 12) - 1;

function monthsBack(n) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

// Simulerer én portefølje over de givne måneder.
function simulate(holdings, data, months, { initial, monthly, rebalance, extra = [] }) {
  const total = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  const w = holdings.map((h) => h.weight / total);
  let pos = w.map((x) => x * initial);
  let contributed = initial;
  let idx = 1;
  const points = [{ month: months[0], value: initial, contributed, index: 1 }];
  const monthlyReturns = [];

  for (let t = 1; t < months.length; t++) {
    const before = pos.reduce((a, b) => a + b, 0);
    pos = pos.map((v, i) => v * (1 + ret(holdings[i].ticker, data, months[t - 1], months[t])));
    const after = pos.reduce((a, b) => a + b, 0);
    const r = before > 0 ? after / before - 1 : 0;
    idx *= 1 + r;
    monthlyReturns.push(r);
    // Indskud fordeles efter målvægte
    // Månedligt indskud + evt. engangsindskud (fx 100.000 kr. efter 2 måneder)
    const deposit = monthly + extra.filter((e) => Number(e.after) === t).reduce((a, e) => a + Number(e.amount || 0), 0);
    pos = pos.map((v, i) => v + w[i] * deposit);
    contributed += deposit;
    const doRebal = rebalance === 'monthly' || (rebalance === 'yearly' && months[t].endsWith('-01'));
    if (doRebal) {
      const tot = pos.reduce((a, b) => a + b, 0);
      pos = w.map((x) => x * tot);
    }
    points.push({ month: months[t], value: pos.reduce((a, b) => a + b, 0), contributed, index: idx });
  }
  return { points, monthlyReturns, metrics: metrics(points, monthlyReturns) };
}

function ret(ticker, data, m0, m1) {
  if (isFixed(ticker)) return fixedRate(ticker);
  const s = data.get(ticker).series;
  return s.get(m1) / s.get(m0) - 1;
}

function metrics(points, rets) {
  const n = rets.length;
  const last = points[points.length - 1];
  const cagr = n ? Math.pow(last.index, 12 / n) - 1 : 0;
  const mean = rets.reduce((a, b) => a + b, 0) / (n || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const vol = sd * Math.sqrt(12);
  let peak = 0;
  let maxDD = 0;
  const drawdown = points.map((p) => {
    peak = Math.max(peak, p.index);
    const dd = p.index / peak - 1;
    maxDD = Math.min(maxDD, dd);
    return { month: p.month, dd };
  });
  // Kalenderårsafkast ud fra indekset (første år kan være delvist)
  const yearEnd = {};
  for (const p of points) yearEnd[p.month.slice(0, 4)] = p.index;
  const annual = [];
  let prevIdx = 1;
  for (const y of Object.keys(yearEnd).sort()) {
    annual.push({ year: y, return: yearEnd[y] / prevIdx - 1 });
    prevIdx = yearEnd[y];
  }
  // Bedste/værste år regnes kun på hele kalenderår
  const full = annual.filter((a) => points.some((p) => p.month === `${a.year}-01`) && points.some((p) => p.month === `${a.year}-12`));
  return {
    finalValue: last.value,
    contributed: last.contributed,
    gain: last.value - last.contributed,
    cagr,
    volatility: vol,
    maxDrawdown: maxDD,
    ratio: vol > 0 ? cagr / vol : null,
    best: full.length ? full.reduce((a, b) => (b.return > a.return ? b : a)) : null,
    worst: full.length ? full.reduce((a, b) => (b.return < a.return ? b : a)) : null,
    annual,
    drawdown,
  };
}

async function run({ portfolios, benchmark, years, initial = 100000, monthly = 0, rebalance = 'yearly', extra = [] }) {
  const tickers = new Set();
  const currencies = {};
  for (const p of portfolios) for (const h of p.holdings) if (h.currency) currencies[h.ticker] = h.currency;
  for (const p of portfolios) for (const h of p.holdings) if (!isFixed(h.ticker)) tickers.add(h.ticker);
  if (benchmark && !isFixed(benchmark)) tickers.add(benchmark);

  const data = new Map();
  const errors = [];
  await Promise.all([...tickers].map(async (t) => {
    try { data.set(t, await inDKK(t, currencies[t])); } catch (e) { errors.push(e.message); }
  }));
  if (errors.length) throw new Error([...new Set(errors)].join(' · '));

  // Fælles periode: måneder hvor alle aktiver har en kurs
  let months = years === 'max' ? null : monthsBack(Number(years) * 12);
  let limitedBy = null;
  if (data.size) {
    const sets = [...data.values()];
    const base = sets.reduce((a, b) => (a.series.size <= b.series.size ? a : b));
    let common = [...base.series.keys()].filter((m) => sets.every((s) => s.series.has(m))).sort();
    if (months) {
      const want = months[0];
      if (common[0] > want) {
        const first = sets.map((s) => ({ s, m: [...s.series.keys()].sort()[0] })).sort((a, b) => (a.m < b.m ? 1 : -1))[0];
        limitedBy = { symbol: first.s.symbol, from: first.m };
      }
      common = common.filter((m) => m >= want);
    }
    months = common;
  } else if (!months) {
    months = monthsBack(30 * 12);
  }
  if (months.length < 13) throw new Error('For lidt fælles kurshistorik (under 12 måneder) for de valgte aktiver');

  const opts = { initial: Number(initial), monthly: Number(monthly), rebalance, extra: (extra || []).filter((e) => Number(e.amount) > 0 && Number(e.after) > 0) };
  const results = portfolios.map((p) => ({ name: p.name, holdings: p.holdings, ...simulate(p.holdings, data, months, opts) }));
  const bench = benchmark ? { name: (data.get(benchmark)?.name || benchmark), ticker: benchmark, ...simulate([{ ticker: benchmark, weight: 1 }], data, months, opts) } : null;

  // Korrelation mellem aktiverne (månedlige afkast)
  const assetList = [...data.values()].map((s) => s.symbol);
  const rets = assetList.map((t) => months.slice(1).map((m, i) => ret(t, data, months[i], m)));
  const corr = assetList.map((_, i) => assetList.map((__, j) => correlation(rets[i], rets[j])));

  return {
    from: months[0],
    to: months[months.length - 1],
    months: months.length,
    limitedBy,
    names: Object.fromEntries([...data.values()].map((s) => [s.symbol, s.name])),
    results,
    benchmark: bench,
    correlation: { assets: assetList, matrix: corr },
  };
}

function correlation(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

module.exports = { run, search, setCustomSource };
