// Kategorisering af posteringer + genkendelse af faste (tilbagevendende) poster.

const CATEGORIES = [
  'Løn', 'Lejeindtægt', 'Anden indkomst', 'Bolig', 'Forsyning', 'Forsikring', 'Abonnementer',
  'Transport', 'Dagligvarer', 'Restaurant & café', 'Shopping', 'Sundhed',
  'Fritid', 'Rejser', 'Opsparing & investering', 'Lån & renter', 'Gebyrer',
  'Overførsler', 'Intern overførsel', 'Viderebetalt', 'Andet',
];

// Tælles hverken som indtægt eller forbrug (penge flyttet mellem egne konti)
const INTERNAL = 'Intern overførsel';
// Penge der kun passerer igennem (fx udlæg eller indbetalinger man sender videre til andre)
const PASSTHROUGH = 'Viderebetalt';

// Standardregler: første match vinder. Brugerregler (db.rules) tjekkes før disse.
const DEFAULT_RULES = [
  ['Intern overførsel', ['egen konto', 'egne konti', 'til opsparingskonto', 'fra opsparingskonto', 'overført til budgetkonto', 'overført fra budgetkonto']],
  ['Løn', ['løn', 'loen', 'lønoverførsel', 'salary', 'feriepenge']],
  ['Anden indkomst', [' su ', 'su-', 'udlæg', 'godtgørelse', 'skat tilbage', 'overskydende skat', 'børnepenge', 'boligstøtte', 'udbytte']],
  ['Opsparing & investering', ['nordnet', 'saxo', 'lunar invest', 'june', 'aktiesparekonto', 'pension']],
  ['Bolig', ['e/f ', 'ejerforeningen', 'husleje', 'boligforening', 'realkredit', 'totalkredit', 'nykredit', 'dlr kredit', 'ejerforening', 'andelsforening', 'grundejer']],
  ['Forsyning', ['fibia', 'norlys fiber', 'ørsted', 'orsted', 'norlys', 'ewii', 'andel energi', 'energi', 'fjernvarme', 'forsyning', 'vand', 'el-', 'yousee', 'stofa', 'telia', 'telenor', '3 mobil', 'cbb', 'oister', 'lebara']],
  ['Forsikring', ['rejseforsik', 'europæiske', 'tryg', 'topdanmark', 'alm. brand', 'alm brand', 'codan', 'if forsikring', 'gjensidige', 'lb forsikring', 'privatsikring', 'forsikring']],
  ['Abonnementer', ['fagforening', 'kontingent', 'spotify', 'netflix', 'viaplay', 'hbo', 'max.com', 'disney', 'youtube', 'apple.com', 'icloud', 'tv 2 play', 'tv2 play', 'audible', 'mofibo', 'storytel', 'chatgpt', 'openai', 'claude', 'anthropic', 'microsoft', 'adobe', 'fitness world', 'sats', 'puregym', 'dropbox', 'google storage']],
  ['Dagligvarer', ['fdb', 'eleven', '7-eleven', 'target', 'walmart', 'trader joe', 'kiosk', 'netto', 'føtex', 'fotex', 'bilka', 'rema', 'lidl', 'coop', 'kvickly', 'irma', 'meny', 'spar ', 'aldi', 'løvbjerg', '365discount', 'brugsen', 'superbrugsen', 'dagli', 'min købmand', 'nemlig']],
  ['Restaurant & café', ['doordash', 'uber eats', 'grubhub', 'chipotle', 'kantine', 'bistro', 'kaffe', 'coffee', 'wolt', 'just eat', 'justeat', 'mcdonald', 'burger king', 'starbucks', 'joe & the juice', 'joe and the juice', 'lagkagehuset', 'espresso house', 'emmerys', 'sunset', 'restaurant', 'cafe', 'café', 'pizza', 'sushi', 'bar ', 'bodega', 'grill']],
  ['Transport', ['molslinjen', 'storebaelt', 'storebælt', 'flixbus', 'amtrak', 'greyhound', 'dsb', 'rejsekort', 'circle k', 'q8', 'ok benzin', 'ok plus', 'shell', 'uno-x', 'ingo', 'easypark', 'parkering', 'apcoa', 'bolt', 'uber', 'taxa', 'dantaxi', 'metro', 'movia', 'midttrafik', 'clever', 'brobizz', 'storebælt']],
  ['Sundhed', ['apotek', 'læge', 'tandlæge', 'fysioterapi', 'optiker', 'sygeforsikring danmark']],
  ['Rejser', ['delta ', 'united air', 'lufthansa', 'klm', 'finnair', 'sas ', 'norwegian', 'ryanair', 'easyjet', 'booking.com', 'airbnb', 'hotel', 'hotels.com', 'expedia', 'momondo']],
  ['Shopping', ['ebay', 'dba ', 'vinted', 'zalando', 'h&m', 'matas', 'normal', 'amazon', 'elgiganten', 'power', 'ikea', 'jysk', 'bauhaus', 'silvan', 'harald nyborg', 'magasin', 'salling', 'zara', 'boozt', 'temu', 'shein', 'proshop', 'komplett']],
  ['Fritid', ['tickster', 'billetto', 'festival', 'golf', 'koncert', 'museum', 'biograf', 'kino', 'ticketmaster', 'billetlugen', 'tivoli', 'steam', 'playstation', 'xbox', 'nintendo', 'boghandel', 'saxo.com']],
  ['Lån & renter', ['renter', 'rente ', 'ydelse', 'afdrag', 'lån ', 'kassekredit']],
  ['Gebyrer', ['gebyr udland', 'gebyr', 'kortgebyr', 'kontogebyr', 'overtræk']],
  ['Overførsler', ['mobilepay', 'overførsel', 'overfoersel', 'til konto', 'fra konto']],
];

function categorize(text, amount, userRules = [], date = null) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  const mk = merchantKey(text);
  for (const r of userRules) {
    // En regel kan være begrænset til ind- eller udbetalinger (fx husleje ind fra en lejer)
    if (r.direction === 'in' && amount <= 0) continue;
    if (r.direction === 'out' && amount >= 0) continue;
    if (date && ((r.from && date < r.from) || (r.to && date > r.to))) continue;
    if (r.match && (mk.includes(r.match) || t.includes(r.match.toLowerCase()))) return r.category;
  }
  for (const [cat, words] of DEFAULT_RULES) {
    if (cat === 'Løn' && amount <= 0) continue;
    if (words.some((w) => t.includes(w))) return cat;
  }
  return amount > 0 ? 'Anden indkomst' : 'Andet';
}

// Normaliserer en posteringstekst til en "forretningsnøgle", så månedlige
// posteringer fra samme modtager kan grupperes trods datoer/kortnumre i teksten.
function merchantKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b(visa|dankort|mastercard|kort|nota|ref|mobilepay|mps|bs|betalingsservice|pbs)\b[:.]?/g, ' ')
    .replace(/[0-9]+([.,/-][0-9]+)*/g, ' ')
    .replace(/[^\p{L}&. ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

const DAY = 86400000;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const INTERVALS = [
  { name: 'monthly', label: 'Månedlig', min: 25, max: 36, perMonth: 1 },
  { name: 'quarterly', label: 'Kvartalsvis', min: 84, max: 98, perMonth: 1 / 3 },
  { name: 'halfyearly', label: 'Halvårlig', min: 170, max: 195, perMonth: 1 / 6 },
  { name: 'yearly', label: 'Årlig', min: 350, max: 380, perMonth: 1 / 12 },
];

// Finder tilbagevendende poster i de seneste 15 måneder.
function detectRecurring(transactions) {
  const cutoff = Date.now() - 460 * DAY;
  const groups = new Map();
  for (const tx of transactions) {
    if (tx.pending) continue;
    const d = Date.parse(tx.date);
    if (!(d >= cutoff)) continue;
    const key = merchantKey(tx.text);
    if (key.length < 2) continue;
    const kind = tx.amount < 0 ? 'expense' : 'income';
    const gk = kind + '|' + key;
    if (!groups.has(gk)) groups.set(gk, { key, kind, txs: [] });
    groups.get(gk).txs.push({ ...tx, t: d });
  }

  const out = [];
  for (const g of groups.values()) {
    const txs = g.txs.sort((a, b) => a.t - b.t);
    if (txs.length < 2) continue;
    const gaps = [];
    for (let i = 1; i < txs.length; i++) gaps.push((txs[i].t - txs[i - 1].t) / DAY);
    const gap = median(gaps);
    const iv = INTERVALS.find((x) => gap >= x.min && gap <= x.max);
    if (!iv) continue;
    const minCount = iv.name === 'monthly' ? 3 : 2;
    if (txs.length < minCount) continue;
    // Mindst halvdelen af afstandene skal passe til intervallet
    const fitting = gaps.filter((x) => x >= iv.min * 0.8 && x <= iv.max * 1.2).length;
    if (fitting / gaps.length < 0.6) continue;
    const amounts = txs.map((x) => Math.abs(x.amount));
    const med = median(amounts);
    const spread = median(amounts.map((a) => Math.abs(a - med))) / (med || 1);
    if (spread > 0.25) continue;
    const last = txs[txs.length - 1];
    // Ignorer poster der ikke er set i lang tid (opsagt)
    if (Date.now() - last.t > iv.max * 1.6 * DAY) continue;
    const amount = Math.round(med * 100) / 100;
    out.push({
      key: g.kind + '|' + g.key,
      kind: g.kind,
      name: prettyName(last.text),
      category: last.category,
      amount,
      interval: iv.name,
      intervalLabel: iv.label,
      perMonth: Math.round(amount * iv.perMonth * 100) / 100,
      count: txs.length,
      lastDate: last.date,
      nextDate: new Date(last.t + gap * DAY).toISOString().slice(0, 10),
    });
  }
  return out.sort((a, b) => b.perMonth - a.perMonth);
}

function prettyName(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > 42 ? s.slice(0, 40) + '…' : s;
}

function perMonth(amount, interval) {
  const iv = INTERVALS.find((x) => x.name === interval);
  return amount * (iv ? iv.perMonth : 1);
}

module.exports = { CATEGORIES, INTERNAL, PASSTHROUGH, categorize, merchantKey, detectRecurring, perMonth, INTERVALS };
