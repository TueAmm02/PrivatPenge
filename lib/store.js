// Simpel JSON-database i data/db.json. Skrives atomisk (tmp-fil + rename).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'db.json');

const EMPTY = {
  accounts: [],      // {id, name, source:'csv'|'enablebanking', iban, currency, balance, balanceDate, ebUid}
  transactions: [],  // {id, accountId, date, text, amount, balance, category, source, pending}
  rules: [],         // brugerregler: {match, category}
  fixed: [],         // faste poster: {id, name, key, amount, interval, category, kind:'expense'|'income'}
  hiddenRecurring: [],
  assets: [],        // {id, name, type, value, debt, expectedReturn, note, history:[{date,value,debt}]}
  holdings: [],      // portefølje: {id, name, ticker, quantity, cost, currency, account, manualPrice, lastPrice, priceDate, fx}
  portfolioHistory: [], // samlet værdi pr. dag: {date, value, cost}
  hiddenSubs: [],    // nøgler på træk der ikke er abonnementer
  alertState: {},    // alarmer der er notificeret/skjult: {nøgle: {notifiedAt, dismissed}}
  settings: {},      // {notify: {mac, email}}
  eb: null,          // {sessionId, validUntil, aspsp, accounts:[uid], lastSync}
};

let db = null;

function load() {
  if (db) return db;
  try {
    db = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    db = structuredClone(EMPTY);
  }
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}

function id() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = { load, save, id };
