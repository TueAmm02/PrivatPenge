// Aktuelle kurser og valutakurser til porteføljen. Kilde: Alpha Vantage (gratis nøgle i .env).
// Gratisnøglen giver 25 kald i døgnet, så svar gemmes i data/prices og genbruges i 12 timer.
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'prices');
const HOURS = 3600 * 1000;

async function cached(key, ttl, fn, force = false) {
  const file = path.join(CACHE_DIR, key.replace(/[^a-z0-9._-]/gi, '_') + '.json');
  if (!force) {
    try {
      const hit = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - hit.t < ttl) return hit.v;
    } catch {}
  }
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
    if (/per day|daily/i.test(note)) throw Object.assign(new Error('Dagens gratis-kvote hos Alpha Vantage er brugt op (25 kald/døgn)'), { code: 'QUOTA' });
    if (/premium/i.test(note)) throw new Error(`${params.symbol || ''} kræver et betalt abonnement hos Alpha Vantage`);
    throw new Error('For mange kald på kort tid – prøv igen om et øjeblik');
  }
  return json;
}

// Valuta ud fra børs-suffiks, når den ikke er angivet (fx NOVO-B.CPH → DKK)
const SUFFIX_CCY = { LON: 'GBX', DEX: 'EUR', FRK: 'EUR', AMS: 'EUR', PAR: 'EUR', MIL: 'EUR', BRU: 'EUR', LIS: 'EUR', MAD: 'EUR', HEL: 'EUR', CPH: 'DKK', STO: 'SEK', OSL: 'NOK', SWX: 'CHF', TRT: 'CAD', TRV: 'CAD', HKG: 'HKD' };
const guessCurrency = (sym) => SUFFIX_CCY[(String(sym).split('.')[1] || '').toUpperCase()] || 'USD';

// Seneste lukkekurs for et symbol
async function quote(symbol, force) {
  return cached('quote_' + symbol, 12 * HOURS, async () => {
    const q = (await av({ function: 'GLOBAL_QUOTE', symbol }))['Global Quote'] || {};
    const price = Number(q['05. price']);
    if (!price) throw new Error(`Ingen kurs for ${symbol} – findes symbolet hos Alpha Vantage?`);
    return { price, date: q['07. latest trading day'] || null, changePct: parseFloat(q['10. change percent']) || 0 };
  }, force);
}

// Kurs for 1 enhed af valutaen i DKK
async function fxToDKK(currency, force) {
  if (currency === 'DKK') return 1;
  return cached('fx_' + currency + 'DKK', 12 * HOURS, async () => {
    const r = (await av({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: currency, to_currency: 'DKK' }))['Realtime Currency Exchange Rate'] || {};
    const rate = Number(r['5. Exchange Rate']);
    if (!rate) throw new Error(`Ingen valutakurs for ${currency}`);
    return rate;
  }, force);
}

async function search(q) {
  return cached('search_' + q.toLowerCase(), 30 * 24 * HOURS, async () => {
    const json = await av({ function: 'SYMBOL_SEARCH', keywords: q });
    return (json.bestMatches || []).map((x) => ({
      symbol: x['1. symbol'], name: x['2. name'], type: x['3. type'], region: x['4. region'], currency: x['8. currency'],
    }));
  });
}

module.exports = { quote, fxToDKK, search, guessCurrency };
