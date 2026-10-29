// Fiktive demodata (13 måneder), så dashboardet kan prøves før egne data er koblet på.

const { merchantKey } = require('./categorize');

function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function load(db, store, insertTransactions) {
  clear(db);
  const r = rng(42);
  // Værelsesudlejning: indbetalinger fra lejeren tælles som lejeindtægt
  db.rules.unshift({ id: store.id(), demo: true, match: 'husleje værelse', category: 'Lejeindtægt', direction: 'in' });
  const acc = { id: store.id(), name: 'Lønkonto (demo)', source: 'demo', demo: true, iban: '', currency: 'DKK', balance: null, balanceDate: null };
  db.accounts.push(acc);

  const rows = [];
  const add = (d, text, amount) => rows.push({ date: d.toISOString().slice(0, 10), text, amount: Math.round(amount * 100) / 100 });
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));

  for (let m = 0; m <= 12; m++) {
    const y = start.getUTCFullYear();
    const mo = start.getUTCMonth() + m;
    const day = (d) => new Date(Date.UTC(y, mo, d));
    const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const inPast = (d) => d <= now;

    const fixed = [
      [1, 'Ejerforening fællesudgifter', -1850],
      [2, 'Spotify P1234', -119],
      [5, 'Netflix.com', -129],
      [6, 'Telia mobil', -169],
      [8, 'Fitness World', -299],
      [10, 'Norlys el aconto', -720],
      [3, 'Nordnet opsparing', -3000],
      [15, 'Tryg forsikring', -612],
      [20, 'YouSee bredbånd', -299],
      [2, 'Overført til opsparingskonto', -9000],
    ];
    for (const [d, text, a] of fixed) if (inPast(day(d))) add(day(d), text, a);
    if (m % 3 === 0 && inPast(day(12))) add(day(12), 'Fjernvarme aconto', -1450);
    if ((mo + 1) % 3 === 0 && inPast(day(30))) add(day(30), 'Realkredit Danmark termin', -16985);
    if (inPast(day(1))) add(day(1), 'Husleje værelse Mikkel', 4500);
    if (m === 4 && inPast(day(18))) add(day(18), 'Gjensidige bilforsikring årlig', -4890);

    // Løn sidste bankdag
    const pay = day(days);
    while ([0, 6].includes(pay.getUTCDay())) pay.setUTCDate(pay.getUTCDate() - 1);
    if (inPast(pay)) add(pay, 'Lønoverførsel', 29850 + (m === 4 ? 6200 : 0));

    const shops = ['Netto', 'Føtex', 'Rema 1000', 'Lidl', 'Coop 365discount', 'Meny'];
    const eat = ['Wolt', 'Joe & The Juice', 'Lagkagehuset', 'Restaurant Mother', 'Sunset Boulevard', 'Café Norden'];
    const misc = [['DSB', 'Transport'], ['Rejsekort', 'Transport'], ['Circle K', 'Transport'], ['Matas', 'Shopping'], ['Zalando', 'Shopping'], ['Apotek', 'Sundhed'], ['Biograf Palads', 'Fritid'], ['MobilePay Jonas', 'Overførsler']];
    for (let d = 1; d <= days; d++) {
      const dt = day(d);
      if (!inPast(dt)) break;
      if (r() < 0.45) add(dt, `Visa/Dankort ${shops[Math.floor(r() * shops.length)]} ${String(d).padStart(2, '0')}.${String((mo % 12) + 1).padStart(2, '0')}`, -(80 + r() * 420));
      if (r() < 0.18) add(dt, `Visa/Dankort ${eat[Math.floor(r() * eat.length)]}`, -(60 + r() * 380));
      if (r() < 0.12) { const [t] = misc[Math.floor(r() * misc.length)]; add(dt, `Visa/Dankort ${t}`, -(40 + r() * 600)); }
    }
    if (m === 7 && inPast(day(14))) add(day(14), 'SAS Scandinavian Airlines', -3420);
    if (m === 7 && inPast(day(15))) add(day(15), 'Booking.com hotel', -5180);
    if (m === 9 && inPast(day(22))) add(day(22), 'MobilePay fra Mor', 1500);
  }

  // Saldo baglæns fra en aktuel saldo
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  let bal = 24350;
  for (let i = rows.length - 1; i >= 0; i--) { rows[i].balance = Math.round(bal * 100) / 100; bal -= rows[i].amount; }
  acc.balance = rows[rows.length - 1].balance;
  acc.balanceDate = rows[rows.length - 1].date;
  insertTransactions(db, acc, rows, 'demo');

  const ahead = (months, d = 1) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, d)).toISOString().slice(0, 7);
  const q = 2 - (now.getUTCMonth() % 3); // måneder til næste kvartalstermin
  const loan = {
    lender: 'Realkredit Danmark', principal: 1580000, balanceDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCMonth() % 3), 0)).toISOString().slice(0, 10),
    rate: 3.5, bidragPerTerm: 3160, termsPerYear: 4, fixed: true, taxDeduction: 25,
    nextTerm: ahead(q) + '-30', ioUntil: ahead(q + 48) + '-30', endDate: ahead(q + 348) + '-30',
  };
  const fixedItem = (name, text, amount, interval, category, kind, extra = {}) =>
    ({ id: store.id(), demo: true, name, key: kind + '|' + merchantKey(text), amount, interval, category, kind, ...extra });
  db.fixed.push(
    fixedItem('Løn', 'Lønoverførsel', 29850, 'monthly', 'Løn', 'income'),
    fixedItem('Husleje – lejer', 'Husleje værelse Mikkel', 4500, 'monthly', 'Lejeindtægt', 'income', { until: ahead(8) }),
    fixedItem('Realkreditlån', 'Realkredit Danmark termin', 16985, 'quarterly', 'Bolig', 'expense'),
    fixedItem('Ejerforening', 'Ejerforening fællesudgifter', 1850, 'monthly', 'Bolig', 'expense'),
    fixedItem('El', 'Norlys el aconto', 720, 'monthly', 'Forsyning', 'expense'),
    fixedItem('Fjernvarme', 'Fjernvarme aconto', 1450, 'quarterly', 'Forsyning', 'expense'),
    fixedItem('Bredbånd', 'YouSee bredbånd', 299, 'monthly', 'Forsyning', 'expense'),
    fixedItem('Forsikring', 'Tryg forsikring', 612, 'monthly', 'Forsikring', 'expense'),
  );

  const back = (months) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)).toISOString().slice(0, 10);
  // Portefølje med egne (fiktive) kurser i DKK, så demoen virker uden API-nøgle
  const holding = (name, account, quantity, cost, manualPrice) => ({ id: store.id(), demo: true, name, ticker: '', quantity, cost, currency: 'DKK', account, manualPrice, manualDate: back(0) });
  db.holdings.push(
    holding('Sparindex Globale Aktier KL (demo)', 'Aktiesparekonto', 520, 78000, 182.4),
    holding('Danske Invest Global Indeks (demo)', 'Frit depot', 310, 41500, 151.9),
    holding('Novo Nordisk B (demo)', 'Frit depot', 40, 31200, 702.5),
    holding('Nordnet Indexfond Teknologi (demo)', 'Frit depot', 95, 19000, 236.0),
  );
  const target = sum(db.holdings.filter((h) => h.demo), (h) => h.quantity * h.manualPrice);
  for (let i = 12; i >= 1; i--) {
    const wobble = 1 + Math.sin(i * 1.7) * 0.03;
    db.portfolioHistory.push({ demo: true, date: back(i), value: Math.round(target * (1 - i * 0.012) * wobble), cost: 169700 - (i > 6 ? 19000 : 0) });
  }
  db.assets.push(
    { id: store.id(), demo: true, name: 'Lejlighed (demo)', type: 'bolig', value: 2450000, debt: 1580000, expectedReturn: 3, note: 'Vurdering fra boligberegner', loan, history: [
      { date: back(12), value: 2350000, debt: 1625000 }, { date: back(6), value: 2400000, debt: 1603000 }, { date: back(0), value: 2450000, debt: 1580000 }] },
    { id: store.id(), demo: true, name: 'Maleri, Per Kirkeby-litografi (demo)', type: 'kunst', value: 35000, debt: 0, expectedReturn: 2, note: 'Forsikringsværdi', history: [
      { date: back(12), value: 32000, debt: 0 }, { date: back(0), value: 35000, debt: 0 }] },
  );
}

function clear(db) {
  const demoAcc = new Set(db.accounts.filter((a) => a.demo).map((a) => a.id));
  db.accounts = db.accounts.filter((a) => !a.demo);
  db.transactions = db.transactions.filter((t) => !demoAcc.has(t.accountId) && t.source !== 'demo');
  db.assets = db.assets.filter((a) => !a.demo);
  db.fixed = db.fixed.filter((f) => !f.demo);
  db.rules = db.rules.filter((r) => !r.demo);
  db.holdings = db.holdings.filter((h) => !h.demo);
  db.portfolioHistory = db.portfolioHistory.filter((p) => !p.demo);
}

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

module.exports = { load, clear };
