// Klient til Enable Banking (PSD2-aggregator). Dokumentation: https://enablebanking.com/docs/api/reference/
// Godkendelse sker med en JWT signeret (RS256) med den private nøgle fra Enable Banking-kontrolpanelet.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://api.enablebanking.com';

function config() {
  const appId = process.env.ENABLE_BANKING_APP_ID || '';
  const keyPath = path.resolve(__dirname, '..', process.env.ENABLE_BANKING_KEY_PATH || 'keys/enablebanking.pem');
  const redirectUrl = process.env.ENABLE_BANKING_REDIRECT_URL || `http://localhost:${process.env.PORT || 5180}/api/eb/callback`;
  return { appId, keyPath, redirectUrl, configured: !!appId && fs.existsSync(keyPath) };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function jwt() {
  const { appId, keyPath } = config();
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
  const body = b64url(JSON.stringify({ iss: 'enablebanking.io', aud: 'api.enablebanking.com', iat, exp: iat + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), fs.readFileSync(keyPath));
  return `${head}.${body}.${b64url(sig)}`;
}

async function call(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data.message || data.detail || data.error || text;
    throw new Error(`Enable Banking ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

async function listBanks(country = 'DK') {
  const data = await call('GET', `/aspsps?country=${country}&psu_type=personal`);
  return (data.aspsps || []).map((a) => ({ name: a.name, country: a.country, logo: a.logo, maxDays: a.maximum_consent_validity }));
}

async function startAuth(bankName, country, state) {
  const { redirectUrl } = config();
  const validUntil = new Date(Date.now() + 89 * 86400000).toISOString();
  const data = await call('POST', '/auth', {
    access: { valid_until: validUntil },
    aspsp: { name: bankName, country },
    state,
    redirect_url: redirectUrl,
    psu_type: 'personal',
  });
  return data.url;
}

async function createSession(code) {
  return call('POST', '/sessions', { code });
}

async function balances(uid) {
  const data = await call('GET', `/accounts/${uid}/balances`);
  const list = data.balances || [];
  // Foretræk bogført saldo, ellers disponibel/første
  const pick = ['CLBD', 'ITBD', 'XPCD', 'ITAV', 'CLAV'];
  const rank = (b) => (pick.includes(b.balance_type) ? pick.indexOf(b.balance_type) : 99);
  list.sort((a, b) => rank(a) - rank(b));
  const b = list[0];
  return b ? { amount: Number(b.balance_amount.amount), currency: b.balance_amount.currency, date: b.reference_date || null } : null;
}

async function transactions(uid, dateFrom) {
  const out = [];
  let ck = null;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (ck) q.set('continuation_key', ck);
    const data = await call('GET', `/accounts/${uid}/transactions?${q}`);
    out.push(...(data.transactions || []));
    ck = data.continuation_key;
    if (!ck) break;
  }
  return out.map(normalizeTx);
}

function normalizeTx(t) {
  const amt = Number(t.transaction_amount?.amount || 0);
  const sign = t.credit_debit_indicator === 'DBIT' ? -1 : 1;
  const counterpart = sign < 0 ? t.creditor?.name : t.debtor?.name;
  const rem = Array.isArray(t.remittance_information) ? t.remittance_information.join(' ') : t.remittance_information || '';
  return {
    extId: t.transaction_id || t.entry_reference || null,
    date: t.booking_date || t.value_date || t.transaction_date,
    text: (rem || counterpart || t.bank_transaction_code?.description || 'Postering').trim(),
    amount: sign * Math.abs(amt),
    balance: t.balance_after_transaction ? Number(t.balance_after_transaction.balance_amount?.amount) : null,
    pending: t.status && t.status !== 'BOOK',
  };
}

module.exports = { config, listBanks, startAuth, createSession, balances, transactions };
