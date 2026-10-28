// Indlæser CSV-eksporter fra danske netbanker (fx sparekasser, Danske Bank, Nordnet).
// Formatet varierer, så kolonner findes ud fra overskrifter, ellers ud fra indhold.

function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectSep(lines) {
  const cands = [';', '\t', ','];
  let best = ';';
  let bestScore = -1;
  for (const s of cands) {
    const counts = lines.slice(0, 10).map((l) => splitLine(l, s).length);
    const score = Math.min(...counts) > 1 ? counts.reduce((a, b) => a + b, 0) : 0;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

// "1.234,56" / "-1234,56" / "1,234.56" / "1234.56" → tal
function parseAmount(s) {
  if (s == null) return NaN;
  let t = String(s).replace(/\s|kr\.?|dkk/gi, '').replace(/−/g, '-');
  if (!t) return NaN;
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  return /^[-+]?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// "28.10.2026" / "28-10-2026" / "2026-10-28" / "28/10/26" → "2026-10-28"
function parseDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const HEAD = {
  date: ['bogføringsdato', 'bogført', 'dato', 'date', 'posteringsdato', 'handelsdag'],
  text: ['tekst', 'posteringstekst', 'beskrivelse', 'description', 'modtager', 'transaktionstekst', 'værdipapirer'],
  amount: ['beløb', 'belob', 'amount', 'beløb dkk'],
  balance: ['saldo', 'balance'],
};

function findCol(header, names) {
  const h = header.map((x) => x.toLowerCase());
  for (const n of names) {
    const i = h.findIndex((x) => x === n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = h.findIndex((x) => x.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

function parseBankCsv(raw) {
  const lines = String(raw).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Filen er tom');
  const sep = detectSep(lines);
  const rows = lines.map((l) => splitLine(l, sep));

  let start = 0;
  let col = null;
  const header = rows[0];
  if (header.some((c) => parseDate(c) === null) && findCol(header, HEAD.date) >= 0) {
    col = {
      date: findCol(header, HEAD.date),
      text: findCol(header, HEAD.text),
      amount: findCol(header, HEAD.amount),
      balance: findCol(header, HEAD.balance),
    };
    start = 1;
  } else {
    // Ingen overskrift: dato = første dato-kolonne, beløb/saldo = de sidste talkolonner,
    // tekst = længste ikke-tal-kolonne.
    const r = rows[0];
    const dateIdx = r.findIndex((c) => parseDate(c));
    const nums = r.map((c, i) => (i !== dateIdx && !isNaN(parseAmount(c)) ? i : -1)).filter((i) => i >= 0);
    const texts = r.map((c, i) => (i !== dateIdx && !nums.includes(i) ? i : -1)).filter((i) => i >= 0);
    col = {
      date: dateIdx,
      amount: nums.length >= 2 ? nums[nums.length - 2] : nums[0],
      balance: nums.length >= 2 ? nums[nums.length - 1] : -1,
      text: texts.sort((a, b) => r[b].length - r[a].length)[0] ?? -1,
    };
  }
  if (col.date < 0 || col.amount < 0) {
    throw new Error('Kunne ikke finde kolonner for dato og beløb. Forventede fx "Dato;Tekst;Beløb;Saldo".');
  }

  const out = [];
  for (const r of rows.slice(start)) {
    const date = parseDate(r[col.date]);
    const amount = parseAmount(r[col.amount]);
    if (!date || isNaN(amount)) continue;
    const balance = col.balance >= 0 ? parseAmount(r[col.balance]) : NaN;
    out.push({
      date,
      text: col.text >= 0 ? r[col.text] : '',
      amount,
      balance: isNaN(balance) ? null : balance,
    });
  }
  if (!out.length) throw new Error('Ingen posteringer fundet i filen');
  return { rows: out, columns: col, separator: sep };
}

module.exports = { parseBankCsv, parseAmount, parseDate };
