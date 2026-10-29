// Abonnementer og alarmer: finder faste træk (streaming, fitness, forsikring, mobil …) og holder øje med
// husleje/indtægter der ikke er kommet, regninger der ikke er trukket, og nye eller dyrere abonnementer.
const { merchantKey, INTERVALS, INTERNAL, PASSTHROUGH, REFUND } = require('./categorize');

const DAY = 86400000;
const MONTHS_PER = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
const MONTH_NAMES = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

// Kategorier der aldrig er "abonnementer" (bolig og lån har deres egen side, resten er almindeligt forbrug)
const NOT_SUBS = new Set(['Bolig', 'Lån & renter', 'Dagligvarer', 'Restaurant & café', 'Transport', 'Rejser', 'Shopping',
  'Opsparing & investering', 'Overførsler', 'Løn', 'Lejeindtægt', 'Anden indkomst', INTERNAL, PASSTHROUGH, REFUND]);

// Kategorier hvor faste træk typisk er abonnementer; i "Andet" kræves flere og mere ens træk
const SUB_CATS = new Set(['Abonnementer', 'Forsikring', 'Forsyning', 'Fritid', 'Sundhed']);
const last0 = (xs) => xs[xs.length - 1];

const GROUPS = [
  ['Streaming & medier', /spotify|netflix|viaplay|hbo|max\.com|disney|youtube|tv ?2 ?play|audible|mofibo|storytel|podimo|deezer|tidal|apple\.com\/bill|dr\.dk/i],
  ['Apps & software', /apple\.com|icloud|google|microsoft|adobe|chatgpt|openai|claude|anthropic|dropbox|dandomain|one\.com|notion|canva|github/i],
  ['Fitness & fritid', /fitness|sats|puregym|golf|klub|forening|svømme|yoga|crossfit|padel/i],
  ['Medlemskaber', /kontingent|fagforening|a-kasse|akasse|ida\b|hk\b|dansk metal|3f\b/i],
];
function groupOf(sub) {
  if (sub.category === 'Forsikring') return 'Forsikringer';
  if (sub.category === 'Forsyning') return 'Mobil, internet & forsyning';
  for (const [g, re] of GROUPS) if (re.test(sub.text)) return g;
  return sub.category === 'Fritid' ? 'Fitness & fritid' : 'Andet';
}

// Læsbart navn ud fra bankteksten (uden kortnumre, notanumre og "Betalingsservice")
function cleanName(text) {
  let s = String(text || '')
    .replace(/\s*beløb omregnet fra.*$/i, '').replace(/\s+notanr.*$/i, '').replace(/\s*aftalenr.*$/i, '')
    .replace(/^(betalingsservice|mobilepay|mob\.pay\*?|visa\/dankort|dankort-nota)\s*/i, '');
  s = s.split('\\')[0].split(',')[0].replace(/\*+\d*\*?/g, ' ').replace(/\d{6,}/g, ' ').replace(/\s+/g, ' ').trim();
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|[\s/&.-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return s || 'Ukendt';
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const txKey = (t) => (t.amount < 0 ? 'expense|' : 'income|') + merchantKey(t.text);
function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
const fmtKr = (n) => `${Math.round(n).toLocaleString('da-DK')} kr.`;
const fmtDate = (d) => `${Number(d.slice(8, 10))}. ${MONTH_NAMES[Number(d.slice(5, 7)) - 1]}`;

// ---------- Abonnementer ----------
function subscriptions(db, now = Date.now()) {
  const fixedByKey = new Map(db.fixed.map((f) => [f.key, f]));
  const hidden = new Set(db.hiddenSubs || []);
  const groups = new Map();
  for (const t of db.transactions) {
    if (t.amount >= 0 || t.pending || NOT_SUBS.has(t.category)) continue;
    // MobilePay til venner er ikke abonnementer – kun til firmaer i abonnements-kategorierne (fx Djøf)
    if (/^\s*(mob\.pay|mobilepay)/i.test(t.text) && !SUB_CATS.has(t.category)) continue;
    if (now - Date.parse(t.date) > 460 * DAY) continue;
    const k = txKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [key, txs] of groups) {
    txs.sort((a, b) => (a.date < b.date ? -1 : 1));
    const fixed = fixedByKey.get(key);
    if (txs.length < 2 && !fixed) continue;
    const gaps = txs.slice(1).map((t, i) => (Date.parse(t.date) - Date.parse(txs[i].date)) / DAY).filter((g) => g > 3);
    let iv = fixed ? INTERVALS.find((x) => x.name === fixed.interval) : null;
    if (!iv) {
      if (!gaps.length) continue;
      const gap = median(gaps);
      iv = INTERVALS.find((x) => gap >= x.min * 0.9 && gap <= x.max * 1.1);
      if (!iv) continue;
      const fitting = gaps.filter((g) => g >= iv.min * 0.75 && g <= iv.max * 1.25).length;
      if (fitting / gaps.length < 0.6) continue;
    }
    // Ét træk pr. periode: samme forretning flere gange samme dag er ikke et abonnement
    const amounts = txs.map((t) => -t.amount);
    const med = median(amounts);
    const spread = median(amounts.map((a) => Math.abs(a - med))) / (med || 1);
    if (!fixed && spread > (SUB_CATS.has(last0(txs).category) ? 0.35 : 0.1)) continue;
    if (!fixed && !SUB_CATS.has(last0(txs).category) && txs.length < 3) continue;
    const last = txs[txs.length - 1];
    const prev = txs.slice(0, -1).map((t) => -t.amount);
    const lastAmount = -last.amount;
    const prevAmount = prev.length ? median(prev.slice(-3)) : null;
    const nextDate = addMonths(last.date, MONTHS_PER[iv.name]);
    const stopped = now - Date.parse(last.date) > iv.max * 1.6 * DAY;
    const fx = String(last.text).match(/omregnet fra -?[\d.,]+ ([A-Z]{3})/i);
    const sub = {
      key,
      name: fixed?.name || cleanName(last.text),
      text: last.text,
      category: last.category,
      interval: iv.name,
      intervalLabel: iv.label,
      amount: Math.round(lastAmount * 100) / 100,
      perMonth: (fixed ? Number(fixed.amount) : lastAmount) * iv.perMonth,
      count: txs.length,
      firstDate: txs[0].date,
      lastDate: last.date,
      nextDate,
      status: stopped ? 'stopped' : 'active',
      isNew: !stopped && now - Date.parse(txs[0].date) < 75 * DAY && txs.length <= 3,
      priceChange: prevAmount && Math.abs(lastAmount - prevAmount) / prevAmount >= 0.05 ? { from: prevAmount, to: lastAmount, date: last.date } : null,
      currency: fx ? fx[1].toUpperCase() : null,
      fixedId: fixed?.id || null,
      hidden: hidden.has(key),
    };
    sub.group = groupOf(sub);
    out.push(sub);
  }
  return out.sort((a, b) => b.perMonth - a.perMonth);
}

// ---------- Alarmer ----------
// Hver alarm har en fast nøgle, så samme alarm kun notificeres én gang og kan skjules.
function computeAlerts(db, now = Date.now()) {
  const alerts = [];
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const latestTx = db.transactions.reduce((m, t) => (t.date > m ? t.date : m), '');
  // Er bankdata mere end 3 dage gamle, kan vi ikke vide, om noget mangler
  const fresh = latestTx && now - Date.parse(latestTx) < 4 * DAY;

  if (fresh) {
    for (const f of db.fixed) {
      const iv = MONTHS_PER[f.interval];
      if (!iv || !f.key) continue;
      const amount = Number(f.amount) || 0;
      const txs = db.transactions.filter((t) => !t.pending && txKey(t) === f.key).sort((a, b) => (a.date < b.date ? -1 : 1));
      const full = txs.filter((t) => Math.abs(t.amount) >= amount * 0.5);
      if (!full.length) continue; // aldrig set i banken – fx tastet ind manuelt
      const lastFull = full[full.length - 1];
      const expected = addMonths(lastFull.date, iv);
      if (f.until && expected.slice(0, 7) > f.until) continue;
      const income = f.kind === 'income';
      const grace = income ? 4 : iv === 1 ? 5 : 10;
      if (now <= Date.parse(expected) + grace * DAY) continue;
      const since = txs.filter((t) => t.date > lastFull.date);
      const paid = Math.abs(since.reduce((s, t) => s + t.amount, 0));
      const isRent = f.category === 'Lejeindtægt';
      const who = f.name.replace(/^husleje\s*[–-]\s*/i, '');
      alerts.push({
        key: `${income ? 'income' : 'bill'}|${f.id}|${expected}`,
        type: income ? (isRent ? 'rent' : 'income') : 'bill',
        title: income
          ? (isRent ? `${who} har ikke betalt husleje` : `${f.name} er ikke kommet`)
          : `${f.name} er ikke trukket`,
        message: income
          ? `${fmtKr(amount)} plejer at komme omkring ${fmtDate(expected)}${paid > 0 ? `, men der er kun kommet ${fmtKr(paid)}` : ', men der er ikke kommet noget endnu'}.`
          : `Regningen på ca. ${fmtKr(amount)} plejer at blive trukket omkring ${fmtDate(expected)}. Er den betalt et andet sted, eller har du glemt den?`,
        date: expected,
      });
    }
  }

  for (const s of subscriptions(db, now)) {
    if (s.hidden || s.status !== 'active') continue;
    if (s.isNew && !s.fixedId) {
      alerts.push({ key: `sub-new|${s.key}|${s.firstDate}`, type: 'sub', title: `Nyt abonnement: ${s.name}`, message: `${fmtKr(s.amount)} ${s.intervalLabel.toLowerCase()} siden ${fmtDate(s.firstDate)}. Kender du det?`, date: s.firstDate });
    }
    if (s.priceChange && s.priceChange.to > s.priceChange.from && now - Date.parse(s.priceChange.date) < 45 * DAY) {
      alerts.push({ key: `sub-price|${s.key}|${s.priceChange.date}`, type: 'sub', title: `${s.name} er blevet dyrere`, message: `Fra ${fmtKr(s.priceChange.from)} til ${fmtKr(s.priceChange.to)} (${fmtDate(s.priceChange.date)}).`, date: s.priceChange.date });
    }
  }
  for (const x of alerts) x.message = x.message.replace(/kr\.\./g, 'kr.');
  const state = db.alertState || {};
  return alerts.filter((a) => !state[a.key]?.dismissed && a.date <= todayStr).sort((a, b) => (a.date < b.date ? 1 : -1));
}

module.exports = { subscriptions, computeAlerts, cleanName };
