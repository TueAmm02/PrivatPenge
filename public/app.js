// Økonomi-dashboard – frontend (ingen build-trin). Data hentes fra den lokale server.

const S = {
  state: null,
  txs: [],
  recurring: [],
  month: null,
  charts: {},
  txFilter: { q: '', month: '', category: '', account: '', limit: 150 },
  editing: null,
  bt: { holdings: [], name: 'Min portefølje', id: null, compare: new Set(), years: '10', initial: 100000, monthly: 2000, extra: [], rebalance: 'yearly', benchmark: 'VT', result: null },
};

const INTERNAL = 'Intern overførsel';
// Tæller hverken som indtægt eller forbrug
const NEUTRAL = new Set([INTERNAL, 'Viderebetalt']);
const SAVINGS = 'Opsparing & investering';
const ASSET_TYPES = {
  bolig: 'Bolig', depot: 'Aktier / depot', pension: 'Pension', kunst: 'Kunst & samlerobjekter',
  kontant: 'Kontant / opsparing', koretoj: 'Køretøj', krypto: 'Krypto', andet: 'Andet',
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// ---------- hjælpere ----------

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fejl ${res.status}`);
  return data;
}

const fmt = (n, d = 0) => Number(n || 0).toLocaleString('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d });
const kr = (n, d = 0) => `${fmt(n, d)} kr.`;
const krShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${Number((n / 1e6).toFixed(2)).toLocaleString('da-DK')} mio.`;
  if (a >= 1e4) return `${fmt(n / 1e3, 0)} t.`;
  return fmt(n);
};
const pct = (x, d = 1) => (x == null || !isFinite(x) ? '–' : `${fmt(x * 100, d)} %`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const series = (i) => css(`--s${(i % 8) + 1}`);
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shortMonth = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const dateLabel = (d) => d ? `${Number(d.slice(8, 10))}. ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '';
const dateShort = (d) => d ? (d.slice(0, 4) === new Date().toISOString().slice(0, 4) ? dateLabel(d).replace(/ \d{4}$/, '') : dateLabel(d)) : '';
const sum = (xs, f = (x) => x) => xs.reduce((a, b) => a + f(b), 0);
const signClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function addMonths(m, n) {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function monthRange(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

function toast(html, actions = [], ms = 6000) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${html}</span>`;
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = label;
    b.onclick = () => { el.remove(); fn(); };
    el.appendChild(b);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function chart(id, config) {
  S.charts[id]?.destroy();
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--grid');
  S.charts[id] = new Chart(canvas, config);
}

// Fælles akse-/tooltip-opsætning
function baseOptions({ money = true, percent = false, stacked = false, horizontal = false, legend = false } = {}) {
  const tick = (v) => (percent ? `${fmt(v * 100, Math.abs(v) < 0.1 && v !== 0 ? 1 : 0)} %` : money ? krShort(v) : v);
  const valueAxis = { grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: tick, maxTicksLimit: 6, maxRotation: 0 }, stacked };
  const catAxis = { grid: { display: false }, border: { color: css('--axis') }, stacked, ticks: horizontal ? { autoSkip: false } : { autoSkipPadding: 12, maxRotation: 0 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    interaction: { mode: 'index', intersect: false, axis: horizontal ? 'y' : 'x' },
    plugins: {
      legend: { display: legend, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, color: css('--text-2') } },
      tooltip: {
        backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
        borderColor: css('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: { label: (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${percent ? pct(c.parsed[horizontal ? 'x' : 'y']) : kr(c.parsed[horizontal ? 'x' : 'y'])}` },
      },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

const barStyle = (color) => ({ backgroundColor: color, borderRadius: 4, borderSkipped: 'start', borderWidth: 0, maxBarThickness: 28, categoryPercentage: 0.75, barPercentage: 0.9 });
const lineStyle = (color, extra = {}) => ({ borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: css('--surface'), tension: 0.25, ...extra });

// ---------- data ----------

async function refresh() {
  [S.state, S.txs, S.recurring] = await Promise.all([api('GET', '/api/state'), api('GET', '/api/transactions'), api('GET', '/api/recurring')]);
  const months = availableMonths();
  // Start på seneste måned med indtægt, så en halv indeværende måned ikke ligner et underskud
  const prevM = addMonths(new Date().toISOString().slice(0, 7), -1);
  if (!S.month || !months.includes(S.month)) S.month = months.includes(prevM) ? prevM : lastFullMonth() || new Date().toISOString().slice(0, 7);
}

// Seneste måned med indtægt – bruges som "seneste hele måned" i gennemsnit
function lastFullMonth() {
  return availableMonths().find((m) => S.txs.some((t) => t.amount > 0 && t.date.startsWith(m) && !NEUTRAL.has(t.category))) || availableMonths()[0];
}

function availableMonths() {
  return [...new Set(S.txs.map((t) => t.date.slice(0, 7)))].sort().reverse();
}

const accountName = (id) => S.state.accounts.find((a) => a.id === id)?.name || '';

// Opsummering af én måned
function monthStats(m) {
  const txs = S.txs.filter((t) => t.date.startsWith(m) && !NEUTRAL.has(t.category));
  const income = sum(txs.filter((t) => t.amount > 0), (t) => t.amount);
  const savings = -sum(txs.filter((t) => t.amount < 0 && t.category === SAVINGS), (t) => t.amount);
  const spendTx = txs.filter((t) => t.amount < 0 && t.category !== SAVINGS);
  const spend = -sum(spendTx, (t) => t.amount);
  const fixedKeys = new Set(S.state.fixed.filter((f) => f.kind !== 'income').map((f) => f.key).filter(Boolean));
  const fixedSpend = -sum(spendTx.filter((t) => fixedKeys.has(t.key)), (t) => t.amount);
  const byCat = {};
  for (const t of spendTx) byCat[t.category] = (byCat[t.category] || 0) - t.amount;
  return { income, savings, spend, fixedSpend, variable: spend - fixedSpend, net: income - spend - savings, byCat, count: txs.length };
}

function avgStats(m, n = 3) {
  const ms = Array.from({ length: n }, (_, i) => addMonths(m, -(i + 1))).filter((x) => availableMonths().includes(x));
  if (!ms.length) return null;
  const st = ms.map(monthStats);
  const byCat = {};
  for (const s of st) for (const [k, v] of Object.entries(s.byCat)) byCat[k] = (byCat[k] || 0) + v / st.length;
  return { income: sum(st, (s) => s.income) / st.length, spend: sum(st, (s) => s.spend) / st.length, savings: sum(st, (s) => s.savings) / st.length, byCat, n: st.length };
}

const bankTotal = () => sum(S.state.accounts, (a) => a.balance || 0);
const assetsGross = () => sum(S.state.assets, (a) => a.value);
const assetsDebt = () => sum(S.state.assets, (a) => a.debt || 0);
const netWorth = () => bankTotal() + assetsGross() - assetsDebt();

function perMonth(amount, interval) {
  return amount * ({ monthly: 1, quarterly: 1 / 3, halfyearly: 1 / 6, yearly: 1 / 12 }[interval] ?? 1);
}
const fixedActive = (f) => !f.until || f.until >= new Date().toISOString().slice(0, 7);
const fixedMonthly = (kind) => sum(S.state.fixed.filter((f) => (f.kind || 'expense') === kind && fixedActive(f)), (f) => perMonth(Number(f.amount), f.interval));

// Saldo ved månedens udgang pr. konto ud fra posteringernes saldokolonne
function monthEndBalances(months) {
  const out = months.map(() => 0);
  let any = false;
  for (const acc of S.state.accounts) {
    const txs = S.txs.filter((t) => t.accountId === acc.id && t.balance != null).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!txs.length) continue;
    any = true;
    months.forEach((m, i) => {
      let last = null;
      for (const t of txs) { if (t.date.slice(0, 7) <= m) last = t.balance; else break; }
      out[i] += last ?? 0;
    });
  }
  return any ? out : null;
}

// ---------- routing ----------

const VIEWS = { oversigt: viewOverview, posteringer: viewTransactions, faste: viewFixed, formue: viewWealth, bolig: viewHousing, portefolje: viewPortfolio, indstillinger: viewSettings };

function currentView() {
  const v = location.hash.slice(1).split('?')[0];
  return VIEWS[v] ? v : 'oversigt';
}

function render() {
  const v = currentView();
  $$('nav.side a').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
  Object.values(S.charts).forEach((c) => c.destroy());
  S.charts = {};
  VIEWS[v]($('#view'));
}

window.addEventListener('hashchange', render);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

// ---------- Oversigt ----------

function noDataView(el, title) {
  el.innerHTML = `
    <div class="head"><div><h2>${title}</h2></div></div>
    <div class="card empty">
      <h3>Ingen posteringer endnu</h3>
      <p>Forbind din bank, importér en CSV-fil fra netbanken – eller prøv med demodata.</p>
      <p><a class="btn primary" href="#indstillinger">Forbind bank / importér</a>
      <button class="btn" id="loadDemo">Indlæs demodata</button></p>
    </div>`;
  $('#loadDemo').onclick = async () => { await api('POST', '/api/demo'); await refresh(); render(); };
}

// Faste farver pr. kategori, så en kategori har samme farve hver måned. Resten samles i "Øvrigt".
const CAT_COLOR = { 'Bolig': 0, 'Dagligvarer': 1, 'Restaurant & café': 2, 'Transport': 3, 'Shopping': 4, 'Forsyning': 5, 'Rejser': 6, 'Fritid': 7 };

function spendSlices(byCat) {
  const slices = [];
  let other = 0;
  for (const [cat, v] of Object.entries(byCat)) {
    if (v <= 0) continue;
    if (cat in CAT_COLOR) slices.push({ name: cat, value: v, color: series(CAT_COLOR[cat]) });
    else other += v;
  }
  slices.sort((a, b) => b.value - a.value);
  if (other > 0) slices.push({ name: 'Øvrigt', value: other, color: css('--muted'), other: true });
  return slices;
}

// Indtægter grupperet efter kilde; faste poster bruger deres eget navn (fx "Husleje – lejer")
function incomeSources(m) {
  const fixedName = Object.fromEntries(S.state.fixed.map((f) => [f.key, f.name]));
  const groups = {};
  for (const t of S.txs) {
    if (!t.date.startsWith(m) || t.amount <= 0 || NEUTRAL.has(t.category)) continue;
    const name = fixedName[t.key] || prettyText(t.text);
    groups[name] = groups[name] || { name, value: 0, category: t.category };
    groups[name].value += t.amount;
  }
  return Object.values(groups).sort((a, b) => b.value - a.value);
}

function prettyText(text) {
  const s = String(text).replace(/^(mobilepay|mob\.pay\*?|visa\/dankort|dankort-nota)\s*/i, '').replace(/\s*\d{6,}\s*\/?\s*/g, ' ').replace(/\s+notanr.*$/i, '').replace(/\s+/g, ' ').trim();
  return s.length > 34 ? s.slice(0, 32) + '…' : s || 'Indbetaling';
}

function viewOverview(el) {
  if (!S.txs.length) return noDataView(el, 'Oversigt');
  const months = availableMonths();
  const m = S.month;
  const st = monthStats(m);
  const avg = avgStats(m);
  const isCurrent = m === new Date().toISOString().slice(0, 7);
  const left = st.income - st.spend;
  const slices = spendSlices(st.byCat);
  const income = incomeSources(m);
  const topIncome = income.slice(0, 6);
  const restIncome = sum(income.slice(6), (x) => x.value);
  const maxIncome = Math.max(...topIncome.map((x) => x.value), restIncome, 1);
  const vsAvg = (cur, prev, lowerIsGood) => {
    if (!prev) return '';
    const d = cur - prev;
    if (Math.abs(d) < 1) return '<span class="muted">som normalt</span>';
    const good = lowerIsGood ? d < 0 : d > 0;
    return `<span class="${good ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${kr(Math.abs(d))}</span> <span class="muted">ift. gns. ${avg.n} mdr.</span>`;
  };

  el.innerHTML = `
    ${S.state.hasDemo ? '<div class="banner">Du ser <b>demodata</b>. Fjern dem under Indstillinger, når du kobler dine egne konti på.</div>' : ''}
    <div class="head">
      <div><h2>${monthLabel(m).replace(/^\w/, (c) => c.toUpperCase())}</h2><div class="sub">${isCurrent ? 'Indeværende måned – ikke afsluttet' : 'Månedens overblik'}</div></div>
      <div class="filters" style="margin:0">
        <button class="btn small" id="prevM" aria-label="Forrige måned" ${months.indexOf(m) >= months.length - 1 ? 'disabled' : ''}>‹</button>
        <select id="monthSel" aria-label="Vælg måned">${months.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${monthLabel(x)}</option>`).join('')}</select>
        <button class="btn small" id="nextM" aria-label="Næste måned" ${months.indexOf(m) <= 0 ? 'disabled' : ''}>›</button>
      </div>
    </div>

    <div class="grid hero">
      <div class="card kpi big"><div class="label">Indkomst</div><div class="value">${kr(st.income)}</div><div class="delta">${vsAvg(st.income, avg?.income, false)}</div></div>
      <div class="card kpi big"><div class="label">Forbrug</div><div class="value">${kr(st.spend)}</div><div class="delta">${vsAvg(st.spend, avg?.spend, true)}</div></div>
      <div class="card kpi big"><div class="label">${left >= 0 ? 'Tilbage' : 'Brugt mere end indkomsten'}</div><div class="value ${signClass(left)}">${left < 0 ? '−' : ''}${kr(Math.abs(left))}</div><div class="delta">${st.income > 0 && left >= 0 ? `${pct(left / st.income, 0)} af indkomsten` : left < 0 ? 'taget fra opsparing eller saldo' : ''}${st.savings > 0 ? ` · ${kr(st.savings)} sat til side` : ''}</div></div>
      <div class="card kpi big"><div class="label">På kontiene nu</div><div class="value">${kr(bankTotal())}</div><div class="delta muted">${S.state.accounts.length} konti</div></div>
    </div>

    <div class="grid cols-3-2" style="margin-top:16px">
      <div class="card">
        <h3>Hvad gik pengene til?</h3>
        <p class="hint">Forbrug i ${monthLabel(m)} fordelt på kategorier · overførsler mellem egne konti og opsparing tæller ikke med</p>
        ${slices.length ? `<div class="donut-wrap">
          <div class="donut"><canvas id="cDonut" role="img" aria-label="Forbrug fordelt på kategorier"></canvas>
            <div class="donut-center"><div class="muted">Forbrug</div><div class="v">${kr(st.spend)}</div></div>
          </div>
          <ul class="donut-legend">${slices.map((s, i) => `<li data-i="${i}">
            <i class="swatch" style="background:${s.color}"></i><span class="n">${esc(s.name)}</span>
            <span class="num">${kr(s.value)}</span><span class="num muted p">${pct(s.value / st.spend, 0)}</span>
            ${avg && !s.other ? `<span class="num d ${(s.value - (avg.byCat[s.name] || 0)) > 0 ? 'neg' : 'pos'}" title="Forskel ift. gns. ${avg.n} mdr.">${(s.value - (avg.byCat[s.name] || 0)) > 0 ? '▲' : '▼'}</span>` : '<span></span>'}
          </li>`).join('')}</ul>
        </div>` : '<p class="muted">Intet forbrug registreret i måneden.</p>'}
      </div>
      <div class="card">
        <h3>Indkomst</h3>
        <p class="hint">Hvor pengene kom fra i ${monthLabel(m)}</p>
        ${topIncome.length ? `<ul class="bars">${topIncome.map((x) => `<li>
            <div class="row"><span>${esc(x.name)}</span><span class="num">${kr(x.value)}</span></div>
            <div class="bar"><div style="width:${(x.value / maxIncome) * 100}%"></div></div>
          </li>`).join('')}
          ${restIncome > 0 ? `<li><div class="row"><span class="muted">Øvrige indbetalinger</span><span class="num">${kr(restIncome)}</span></div><div class="bar"><div style="width:${(restIncome / maxIncome) * 100}%"></div></div></li>` : ''}
        </ul>
        <div class="row total"><span>I alt</span><span class="num">${kr(st.income)}</span></div>` : '<p class="muted">Ingen indtægter registreret i måneden.</p>'}
      </div>
    </div>
    <p class="hint" style="margin-top:14px"><a href="#posteringer" id="seeAll">Se alle posteringer i ${monthLabel(m)} →</a></p>`;

  $('#monthSel').onchange = (e) => { S.month = e.target.value; render(); };
  $('#prevM').onclick = () => { S.month = months[months.indexOf(m) + 1]; render(); };
  $('#nextM').onclick = () => { S.month = months[months.indexOf(m) - 1]; render(); };
  $('#seeAll').onclick = () => { S.txFilter.month = m; };
  if (!slices.length) return;

  chart('cDonut', {
    type: 'doughnut',
    data: { labels: slices.map((s) => s.name), datasets: [{ data: slices.map((s) => s.value), backgroundColor: slices.map((s) => s.color), borderColor: css('--surface'), borderWidth: 2, hoverOffset: 6, borderRadius: 3 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'), borderColor: css('--border'), borderWidth: 1, padding: 10, usePointStyle: true,
          callbacks: { label: (c) => ` ${kr(c.parsed)} (${pct(c.parsed / st.spend, 0)})` },
        },
      },
    },
  });
  // Hover i forklaringen fremhæver udsnittet
  const ch = S.charts.cDonut;
  $$('.donut-legend li').forEach((li) => {
    li.onmouseenter = () => { ch.setActiveElements([{ datasetIndex: 0, index: Number(li.dataset.i) }]); ch.tooltip.setActiveElements([{ datasetIndex: 0, index: Number(li.dataset.i) }], { x: 0, y: 0 }); ch.update(); };
    li.onmouseleave = () => { ch.setActiveElements([]); ch.tooltip.setActiveElements([], { x: 0, y: 0 }); ch.update(); };
  });
}

function flowBar(st) {
  const parts = [
    ['Faste udgifter', st.fixedSpend, series(1)],
    ['Variabelt forbrug', st.variable, series(3)],
    ['Opsparing', st.savings, series(2)],
    [st.net >= 0 ? 'Tilbage' : 'Underskud', Math.abs(st.net), st.net >= 0 ? css('--grid') : css('--bad')],
  ];
  const total = Math.max(st.income, sum(parts.slice(0, 3), (p) => p[1])) || 1;
  return `
    <div class="flowbar" role="img" aria-label="Fordeling af indtægt">${parts.filter((p) => p[1] > 0).map(([l, v, c]) => `<div title="${l}: ${kr(v)}" style="flex:${v / total};background:${c}"></div>`).join('')}</div>
    <div class="flow-legend">${parts.map(([l, v, c]) => `<div><i class="swatch" style="background:${c}"></i>${l}<div class="v">${kr(v)}</div><div class="muted">${st.income ? pct(v / st.income, 0) + ' af indtægt' : ''}</div></div>`).join('')}</div>
    ${!S.state.fixed.length ? '<p class="hint" style="margin-top:8px">Tip: Bekræft dine faste udgifter under <a href="#faste">Faste poster</a>, så de skilles fra det variable forbrug.</p>' : ''}`;
}

function upcomingHtml() {
  const now = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const fixedKeys = new Set(S.state.fixed.map((f) => f.key));
  const items = S.recurring.filter((r) => r.kind === 'expense' && fixedKeys.has(r.key) && r.nextDate >= now && r.nextDate <= limit).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
  if (!items.length) return `<p class="muted">${S.state.fixed.length ? 'Ingen faste betalinger de næste 30 dage.' : 'Ingen faste poster bekræftet endnu.'}</p>`;
  return `<table><tbody>${items.map((r) => `<tr><td class="muted" style="width:90px">${dateLabel(r.nextDate).replace(/ \d{4}$/, '')}</td><td class="text">${esc(S.state.fixed.find((f) => f.key === r.key)?.name || r.name)}</td><td class="num">${kr(-r.amount)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- Posteringer ----------

function txTable(txs, showAccount = true) {
  if (!txs.length) return '<p class="muted">Ingen posteringer.</p>';
  const cats = S.state.categories;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Dato</th><th>Tekst</th><th>Kategori</th>${showAccount ? '<th>Konto</th>' : ''}<th class="num">Beløb</th></tr></thead>
    <tbody>${txs.map((t) => `<tr>
      <td class="muted" style="white-space:nowrap">${dateLabel(t.date)}</td>
      <td class="text" title="${esc(t.text)}">${esc(t.text)}${t.pending ? ' <span class="pill">afventer</span>' : ''}</td>
      <td><select class="cat" data-tx="${t.id}">${cats.map((c) => `<option ${c === t.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      ${showAccount ? `<td class="muted">${esc(accountName(t.accountId))}</td>` : ''}
      <td class="num ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : ''}${fmt(t.amount, 2)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function bindTxTable(root) {
  $$('select.cat', root).forEach((sel) => {
    sel.onchange = async () => {
      const tx = S.txs.find((t) => t.id === sel.dataset.tx);
      const category = sel.value;
      await api('PATCH', `/api/transactions/${tx.id}`, { category });
      tx.category = category;
      const short = tx.text.length > 28 ? tx.text.slice(0, 26) + '…' : tx.text;
      toast(`Kategori ændret til <b>${esc(category)}</b>.`, [[`Gælder alle "${short}"`, async () => {
        const r = await api('PATCH', `/api/transactions/${tx.id}`, { category, applyRule: true });
        await refresh();
        render();
        toast(`${r.updated} posteringer opdateret – og nye fremover.`);
      }]], 9000);
      if (currentView() === 'oversigt') render();
    };
  });
}

function viewTransactions(el) {
  if (!S.txs.length) return noDataView(el, 'Posteringer');
  const f = S.txFilter;
  const months = availableMonths();
  const q = f.q.toLowerCase();
  const list = S.txs.filter((t) =>
    (!f.month || t.date.startsWith(f.month)) &&
    (!f.category || t.category === f.category) &&
    (!f.account || t.accountId === f.account) &&
    (!q || t.text.toLowerCase().includes(q) || String(t.amount).includes(q)));
  const inSum = sum(list.filter((t) => t.amount > 0), (t) => t.amount);
  const outSum = sum(list.filter((t) => t.amount < 0), (t) => t.amount);

  el.innerHTML = `
    <div class="head"><div><h2>Posteringer</h2><div class="sub">${fmt(list.length)} posteringer · ind ${kr(inSum)} · ud ${kr(-outSum)}</div></div>
    <a class="btn" href="#indstillinger">Importér CSV</a></div>
    <div class="card">
      <div class="filters">
        <input type="search" id="fq" placeholder="Søg i tekst eller beløb" value="${esc(f.q)}" style="flex:1;min-width:180px">
        <select id="fm"><option value="">Alle måneder</option>${months.map((m) => `<option value="${m}" ${m === f.month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
        <select id="fc"><option value="">Alle kategorier</option>${S.state.categories.map((c) => `<option ${c === f.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
        ${S.state.accounts.length > 1 ? `<select id="fa"><option value="">Alle konti</option>${S.state.accounts.map((a) => `<option value="${a.id}" ${a.id === f.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
      </div>
      ${txTable(list.slice(0, f.limit), S.state.accounts.length > 1)}
      ${list.length > f.limit ? `<p style="text-align:center"><button class="btn" id="more">Vis flere (${fmt(list.length - f.limit)} tilbage)</button></p>` : ''}
    </div>`;
  const upd = (k) => (e) => { f[k] = e.target.value; f.limit = 150; render(); if (k === 'q') { const i = $('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
  $('#fq').oninput = upd('q');
  $('#fm').onchange = upd('month');
  $('#fc').onchange = upd('category');
  if ($('#fa')) $('#fa').onchange = upd('account');
  if ($('#more')) $('#more').onclick = () => { f.limit += 300; render(); };
  bindTxTable(el);
}

// ---------- Faste poster ----------

const INTERVAL_LABEL = { monthly: 'Månedlig', quarterly: 'Kvartalsvis', halfyearly: 'Halvårlig', yearly: 'Årlig' };

function viewFixed(el) {
  const fixed = S.state.fixed;
  const exp = fixed.filter((f) => (f.kind || 'expense') === 'expense');
  const inc = fixed.filter((f) => f.kind === 'income');
  const found = S.recurring.filter((r) => r.status === 'new');
  const next = Object.fromEntries(S.recurring.map((r) => [r.key, r.nextDate]));
  const expM = fixedMonthly('expense');
  const incM = fixedMonthly('income');
  const avg = S.txs.length ? avgStats(addMonths(lastFullMonth(), 1), 3) : null;
  const incomeBase = incM || avg?.income || 0;

  const rows = (list) => list.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Navn</th><th>Kategori</th><th>Interval</th><th class="num">Beløb</th><th class="num">Pr. måned</th><th>Næste</th><th title="Sidste måned posten gælder">Til og med</th><th></th></tr></thead>
    <tbody>${list.map((f) => `<tr style="${fixedActive(f) ? '' : 'opacity:.5'}">
      <td><input type="text" value="${esc(f.name)}" data-f="${f.id}" data-k="name" style="width:100%;min-width:140px"></td>
      <td><select class="cat" data-f="${f.id}" data-k="category">${S.state.categories.map((c) => `<option ${c === f.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><select data-f="${f.id}" data-k="interval">${Object.entries(INTERVAL_LABEL).map(([k, v]) => `<option value="${k}" ${k === f.interval ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td class="num"><input type="number" value="${f.amount}" data-f="${f.id}" data-k="amount" style="width:100px;text-align:right"></td>
      <td class="num">${kr(perMonth(Number(f.amount), f.interval))}</td>
      <td class="muted" style="white-space:nowrap">${next[f.key] ? dateShort(next[f.key]) : '–'}</td>
      <td><input type="month" value="${f.until || ''}" data-f="${f.id}" data-k="until" style="width:130px" aria-label="Til og med"></td>
      <td><button class="btn small ghost danger" data-del="${f.id}" title="Fjern">✕</button></td>
    </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Ingen endnu.</p>';

  const byCat = {};
  for (const f of exp) byCat[f.category || 'Andet'] = (byCat[f.category || 'Andet'] || 0) + perMonth(Number(f.amount), f.interval);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  el.innerHTML = `
    <div class="head"><div><h2>Faste poster</h2><div class="sub">Løn, husleje/ydelse, forsikringer, abonnementer og andre tilbagevendende poster</div></div></div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Faste udgifter pr. måned</div><div class="value">${kr(expM)}</div><div class="delta">${exp.length} poster · ${kr(expM * 12)} om året</div></div>
      <div class="card kpi"><div class="label">Faste indtægter pr. måned</div><div class="value">${kr(incM)}</div><div class="delta">${inc.length ? inc.map((i) => esc(i.name)).join(', ') : 'Tilføj din løn nedenfor'}</div></div>
      <div class="card kpi"><div class="label">Til rådighed efter faste udgifter</div><div class="value ${signClass(incomeBase - expM)}">${kr(incomeBase - expM)}</div><div class="delta">${incM ? 'faste indtægter − faste udgifter' : avg ? `gns. indtægt (${avg.n} mdr.) − faste udgifter` : ''}</div></div>
      <div class="card kpi"><div class="label">Faste udgifter i % af indtægt</div><div class="value">${incomeBase ? pct(expM / incomeBase, 0) : '–'}</div><div class="delta">&nbsp;</div></div>
    </div>

    ${found.length ? `<div class="card" style="margin-bottom:16px">
      <h3>Fundet automatisk (${found.length})</h3>
      <p class="hint">Poster der går igen med fast interval og næsten samme beløb. Tilføj dem, du vil regne som faste.</p>
      <div class="table-wrap"><table><thead><tr><th>Tekst</th><th>Type</th><th>Interval</th><th class="num">Beløb</th><th>Set</th><th>Næste</th><th></th></tr></thead>
      <tbody>${found.map((r, i) => `<tr>
        <td class="text">${esc(r.name)}</td><td>${r.kind === 'income' ? '<span class="pill">Indtægt</span>' : esc(r.category)}</td>
        <td>${r.intervalLabel}</td><td class="num ${r.kind === 'income' ? 'pos' : ''}">${kr(r.amount)}</td>
        <td class="muted">${r.count} gange</td><td class="muted" style="white-space:nowrap">${dateShort(r.nextDate)}</td>
        <td style="white-space:nowrap"><button class="btn small primary" data-add="${i}">Tilføj</button> <button class="btn small ghost" data-hide="${i}">Skjul</button></td>
      </tr>`).join('')}</tbody></table></div>
      ${found.length > 1 ? '<p style="margin:10px 0 0"><button class="btn small" id="addAll">Tilføj alle</button></p>' : ''}
    </div>` : ''}

    <div class="grid cols-3-2">
      <div class="stack">
        <div class="card"><h3>Faste udgifter</h3><p class="hint">Ret navn, beløb og interval direkte i tabellen.</p>${rows(exp)}</div>
        <div class="card"><h3>Faste indtægter</h3>${rows(inc)}</div>
        <div class="card">
          <h3>Tilføj manuelt</h3>
          <div class="form-row" style="margin-top:10px">
            <label>Navn<input type="text" id="nName" placeholder="fx Husleje"></label>
            <label>Beløb<input type="number" id="nAmt" style="width:110px"></label>
            <label>Interval<select id="nInt">${Object.entries(INTERVAL_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label>Type<select id="nKind"><option value="expense">Udgift</option><option value="income">Indtægt</option></select></label>
            <label>Kategori<select id="nCat">${S.state.categories.map((c) => `<option>${c}</option>`).join('')}</select></label>
            <button class="btn primary" id="nAdd">Tilføj</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Faste udgifter pr. kategori</h3>
        <p class="hint">Omregnet til pr. måned</p>
        ${cats.length ? '<div class="chart tall"><canvas id="cFixed"></canvas></div>' : '<p class="muted">Tilføj faste udgifter for at se fordelingen.</p>'}
      </div>
    </div>`;

  const addRec = (r) => api('POST', '/api/fixed', { name: r.name, key: r.key, amount: r.amount, interval: r.interval, category: r.kind === 'income' ? 'Løn' : r.category, kind: r.kind });
  $$('[data-add]').forEach((b) => (b.onclick = async () => { await addRec(found[b.dataset.add]); await refresh(); render(); }));
  $$('[data-hide]').forEach((b) => (b.onclick = async () => { await api('POST', '/api/recurring/hide', { key: found[b.dataset.hide].key }); await refresh(); render(); }));
  if ($('#addAll')) $('#addAll').onclick = async () => { for (const r of found) await addRec(r); await refresh(); render(); };
  $$('[data-del]').forEach((b) => (b.onclick = async () => { await api('DELETE', `/api/fixed/${b.dataset.del}`); await refresh(); render(); }));
  $$('[data-f]').forEach((inp) => (inp.onchange = async () => {
    await api('PUT', `/api/fixed/${inp.dataset.f}`, { [inp.dataset.k]: inp.dataset.k === 'amount' ? Number(inp.value) : inp.value });
    await refresh(); render();
  }));
  $('#nAdd').onclick = async () => {
    const name = $('#nName').value.trim();
    const amount = Number($('#nAmt').value);
    if (!name || !amount) return toast('Udfyld navn og beløb');
    await api('POST', '/api/fixed', { name, amount: Math.abs(amount), interval: $('#nInt').value, kind: $('#nKind').value, category: $('#nCat').value });
    await refresh(); render();
  };
  if (cats.length) chart('cFixed', { type: 'bar', data: { labels: cats.map((c) => c[0]), datasets: [{ label: 'Pr. måned', data: cats.map((c) => c[1]), ...barStyle(series(1)) }] }, options: baseOptions({ horizontal: true }) });
}

// ---------- Formue ----------

function viewWealth(el) {
  const assets = S.state.assets;
  const bank = bankTotal();
  const gross = assetsGross() + bank;
  const debt = assetsDebt();
  const bolig = assets.filter((a) => a.type === 'bolig');
  const ed = S.editing;

  const form = (a = {}) => `
    <div class="form-row" style="margin-top:10px">
      <label>Navn<input type="text" id="aName" value="${esc(a.name || '')}" placeholder="fx Lejlighed på Nørrebro"></label>
      <label>Type<select id="aType">${Object.entries(ASSET_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Værdi (kr.)<input type="number" id="aVal" value="${a.value ?? ''}" style="width:130px"></label>
      <label>Gæld (kr.)<input type="number" id="aDebt" value="${a.debt || ''}" placeholder="fx realkredit" style="width:130px"></label>
      <label title="Bruges i portefølje-testen som fast årligt afkast">Forventet afkast % p.a.<input type="number" step="0.1" id="aRet" value="${a.expectedReturn ?? ''}" style="width:90px"></label>
      <label>Pr. dato<input type="date" id="aDate" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label style="flex:1;min-width:160px">Note<input type="text" id="aNote" value="${esc(a.note || '')}" placeholder="fx kilde til vurdering"></label>
    </div>`;

  el.innerHTML = `
    <div class="head"><div><h2>Formue</h2><div class="sub">Bankkonti, bolig, depot, pension, kunst og andre aktiver minus gæld</div></div></div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Nettoformue</div><div class="value">${kr(gross - debt)}</div><div class="delta">aktiver − gæld</div></div>
      <div class="card kpi"><div class="label">Aktiver i alt</div><div class="value">${kr(gross)}</div><div class="delta">heraf bank ${kr(bank)}</div></div>
      <div class="card kpi"><div class="label">Gæld</div><div class="value">${kr(debt)}</div><div class="delta">${gross ? pct(debt / gross, 0) + ' af aktiverne' : ''}</div></div>
      ${bolig.length ? `<div class="card kpi"><div class="label">Friværdi i bolig</div><div class="value">${kr(sum(bolig, (a) => a.value - (a.debt || 0)))}</div><div class="delta">belåning ${pct(sum(bolig, (a) => a.debt || 0) / (sum(bolig, (a) => a.value) || 1), 0)}</div></div>` : ''}
    </div>
    <div class="grid cols-3-2">
      <div class="stack">
        <div class="card">
          <h3>Aktiver</h3>
          <p class="hint">Opdatér værdien jævnligt (fx boligvurdering, depotværdi fra Nordnet) – hver opdatering gemmes, så udviklingen kan følges.</p>
          ${S.state.accounts.map((a) => `<div class="asset"><div><div class="name">${esc(a.name)}</div><div class="meta">Bankkonto${a.balanceDate ? ' · saldo pr. ' + dateLabel(a.balanceDate) : ''}</div></div><div class="num">${kr(a.balance || 0)}</div></div>`).join('')}
          ${assets.map((a) => ed === a.id ? `<div class="asset" style="display:block">${form(a)}<p style="margin:10px 0 0"><button class="btn primary" id="aSave">Gem</button> <button class="btn" id="aCancel">Annullér</button> <button class="btn ghost danger" id="aDel">Slet</button></p></div>` : `
            <div class="asset">
              <div><div class="name">${esc(a.name)} <span class="pill">${ASSET_TYPES[a.type] || a.type}</span></div>
              <div class="meta">${a.debt ? `Værdi ${kr(a.value)} · gæld ${kr(a.debt)} · ` : ''}${a.expectedReturn != null ? `forventet ${fmt(a.expectedReturn, 1)} % p.a. · ` : ''}opdateret ${dateLabel(a.history?.[a.history.length - 1]?.date)}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
              <div style="text-align:right"><div class="num" style="font-weight:600">${kr(a.value - (a.debt || 0))}</div><button class="btn small ghost" data-edit="${a.id}">Opdatér</button></div>
            </div>`).join('')}
          ${!assets.length ? '<p class="muted">Ingen aktiver tilføjet endnu – fx din lejlighed, dit Nordnet-depot eller kunst.</p>' : ''}
        </div>
        <div class="card">
          <h3>Tilføj aktiv</h3>
          ${ed === 'new' ? form({ type: 'bolig' }) + '<p style="margin:10px 0 0"><button class="btn primary" id="aSave">Tilføj</button> <button class="btn" id="aCancel">Annullér</button></p>' : '<p style="margin:8px 0 0"><button class="btn primary" id="aNew">+ Nyt aktiv</button></p>'}
        </div>
      </div>
      <div class="stack">
        <div class="card"><h3>Fordeling</h3><p class="hint">Bruttoværdi pr. type (før gæld)</p><div class="chart"><canvas id="cAlloc"></canvas></div></div>
        <div class="card"><h3>Nettoformue over tid</h3><p class="hint">Ud fra de værdier, du har registreret</p><div class="chart short"><canvas id="cNW"></canvas></div><p class="muted" id="nwEmpty" hidden>Udviklingen vises, når du har opdateret værdierne over mindst to måneder.</p></div>
      </div>
    </div>`;

  $$('[data-edit]').forEach((b) => (b.onclick = () => { S.editing = b.dataset.edit; render(); }));
  if ($('#aNew')) $('#aNew').onclick = () => { S.editing = 'new'; render(); };
  if ($('#aCancel')) $('#aCancel').onclick = () => { S.editing = null; render(); };
  if ($('#aDel')) $('#aDel').onclick = async () => { if (!confirm('Slet aktivet og dets historik?')) return; await api('DELETE', `/api/assets/${ed}`); S.editing = null; await refresh(); render(); };
  if ($('#aSave')) $('#aSave').onclick = async () => {
    const body = { name: $('#aName').value.trim() || 'Aktiv', type: $('#aType').value, value: Number($('#aVal').value), debt: Number($('#aDebt').value) || 0, expectedReturn: $('#aRet').value, note: $('#aNote').value, date: $('#aDate').value };
    if (ed === 'new') await api('POST', '/api/assets', body); else await api('PUT', `/api/assets/${ed}`, body);
    S.editing = null;
    await refresh();
    render();
  };

  const byType = {};
  if (bank) byType['Bank'] = bank;
  for (const a of assets) byType[ASSET_TYPES[a.type] || a.type] = (byType[ASSET_TYPES[a.type] || a.type] || 0) + a.value;
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  chart('cAlloc', {
    type: 'bar',
    data: { labels: types.map((t) => t[0]), datasets: [{ label: 'Værdi', data: types.map((t) => t[1]), ...barStyle(series(0)) }] },
    options: { ...baseOptions({ horizontal: true }), plugins: { ...baseOptions({ horizontal: true }).plugins, tooltip: { ...baseOptions({ horizontal: true }).plugins.tooltip, callbacks: { label: (c) => ` ${kr(c.parsed.x)} (${pct(c.parsed.x / gross, 0)})` } } } },
  });

  // Nettoformue pr. måned: hvert aktiv tæller fra sin første registrering
  const dates = assets.flatMap((a) => (a.history || []).map((h) => h.date.slice(0, 7)));
  const first = dates.sort()[0];
  const nowM = new Date().toISOString().slice(0, 7);
  if (first && first < nowM) {
    const months = monthRange(first < addMonths(nowM, -36) ? addMonths(nowM, -36) : first, nowM);
    const bankBal = monthEndBalances(months);
    const vals = months.map((m, i) => {
      let v = bankBal ? bankBal[i] : m === nowM ? bank : 0;
      for (const a of assets) {
        const h = (a.history || []).filter((x) => x.date.slice(0, 7) <= m).pop();
        if (h) v += h.value - (h.debt || 0);
      }
      return v;
    });
    chart('cNW', { type: 'line', data: { labels: months.map(shortMonth), datasets: [{ label: 'Nettoformue', data: vals, ...lineStyle(series(0)), stepped: false }] }, options: baseOptions() });
  } else {
    $('#cNW').parentElement.hidden = true;
    $('#nwEmpty').hidden = false;
  }
}

// ---------- Bolig & lån ----------

// Rentefradrag som fast sats (sættes pr. lån, standard 25 %)
let FRADRAG_RATE = 0.25;
const fradragsvaerdi = (renter) => renter * FRADRAG_RATE;

function addMonthsDate(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

// Terminsplan: renter og bidrag af restgælden, afdrag som annuitet efter afdragsfriheden.
// ioUntil = null betyder afdrag fra næste termin. extraNow = ekstraordinært afdrag i dag.
// fixedPmt = fast rente+afdrag pr. termin efter afdragsfriheden (bruges ved "kortere løbetid").
function loanSchedule(loan, { ioUntil = loan.ioUntil, rate = loan.rate, extraNow = 0, fixedPmt = null } = {}) {
  const n = loan.termsPerYear || 4;
  const step = 12 / n;
  const r = rate / 100 / n;
  const bRate = loan.principal ? loan.bidragPerTerm / loan.principal : 0;
  const end = loan.endDate;
  let bal = Math.max(0, loan.principal - extraNow);
  let date = loan.nextTerm || addMonthsDate(loan.balanceDate, step);
  const terms = [];
  while (end && date <= end && bal > 0.5 && terms.length < 400) {
    const interest = bal * r;
    const bidrag = bal * bRate;
    let afdrag = 0;
    if (!(ioUntil && date <= ioUntil)) {
      const left = Math.round(monthsBetween(date, end) / step) + 1;
      const pmt = fixedPmt || (r ? (bal * r) / (1 - Math.pow(1 + r, -left)) : bal / left);
      afdrag = Math.min(bal, pmt - interest);
    }
    terms.push({ date, balance: bal, interest, bidrag, afdrag, payment: interest + bidrag + afdrag });
    bal -= afdrag;
    date = addMonthsDate(date, step);
  }
  return terms;
}

function byYear(terms) {
  const out = {};
  for (const t of terms) {
    const y = t.date.slice(0, 4);
    out[y] = out[y] || { year: y, interest: 0, bidrag: 0, afdrag: 0, endBalance: 0 };
    out[y].interest += t.interest;
    out[y].bidrag += t.bidrag;
    out[y].afdrag += t.afdrag;
    out[y].endBalance = t.balance - t.afdrag;
  }
  return Object.values(out);
}

const HS = { growth: null, scenario: 'extra', compareRate: '', editLoan: false, assetId: null, extraAmount: 100000, extraMode: 'ydelse', kurs: 100 };

// Kommende boligbetalinger: lånets terminer + faste poster (ejerforening, forsyning) og husleje ind
function housingCalendar(loan, sched, items, rents, months = 12) {
  const nowD = new Date().toISOString().slice(0, 10);
  const endD = addMonthsDate(nowD, months);
  const step = { monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 };
  // Seneste faktiske betalingsdato for posten; datoerne fremad regnes i hele måneder fra den
  const lastOf = (f) => S.txs.filter((t) => t.key === f.key).map((t) => t.date).sort().pop()
    || S.recurring.find((r) => r.key === f.key)?.lastDate
    || nowD.slice(0, 8) + '01';
  const out = [];
  if (loan) for (const t of sched) if (t.date >= nowD && t.date < endD) out.push({ date: t.date, name: `${loan.lender || 'Realkredit'}, termin`, amount: t.payment, group: 'loan', detail: `renter ${kr(t.interest)} · bidrag ${kr(t.bidrag)}${t.afdrag ? ' · afdrag ' + kr(t.afdrag) : ''}` });
  for (const [f, group] of [...items.map((x) => [x[0], x[1]]), ...rents.map((f) => [f, 'rent'])]) {
    const base = lastOf(f);
    const n = step[f.interval] || 1;
    for (let i = 1; i < 60; i++) {
      const d = addMonthsDate(base, i * n);
      if (d >= endD || (f.until && d.slice(0, 7) > f.until)) break;
      if (d >= nowD) out.push({ date: d, name: f.name, amount: Number(f.amount), group });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function viewHousing(el) {
  const homes = S.state.assets.filter((a) => a.type === 'bolig');
  if (!homes.length) {
    el.innerHTML = `<div class="head"><div><h2>Bolig & lån</h2></div></div>
      <div class="card empty"><h3>Ingen bolig registreret</h3><p>Tilføj din bolig under Formue (type "Bolig"), så kan du lægge lånet ind her.</p><p><a class="btn primary" href="#formue">Gå til Formue</a></p></div>`;
    return;
  }
  const home = homes.find((h) => h.id === HS.assetId) || homes[0];
  const loan = home.loan;
  const growth = HS.growth ?? home.expectedReturn ?? 2;
  FRADRAG_RATE = (loan?.taxDeduction ?? 25) / 100;
  const nowM = new Date().toISOString().slice(0, 7);

  // Øvrige boligudgifter og husleje fra de faste poster
  const active = (f) => !f.until || f.until >= nowM;
  const fixedBy = (pred) => S.state.fixed.filter((f) => active(f) && pred(f));
  const loanKey = (f) => /totalkredit|realkredit|nykredit|dlr|bolig ?lån/i.test(f.name);
  const ownerCosts = fixedBy((f) => (f.kind || 'expense') === 'expense' && f.category === 'Bolig' && !loanKey(f));
  const utilities = fixedBy((f) => (f.kind || 'expense') === 'expense' && f.category === 'Forsyning' && !/mobil|telia|telenor/i.test(f.name));
  const rentFixed = fixedBy((f) => f.kind === 'income' && f.category === 'Lejeindtægt');
  const ending = S.state.fixed.filter((f) => f.until && f.until >= nowM && f.category === 'Lejeindtægt');

  const sched = loan ? loanSchedule(loan) : [];
  const yearly = byYear(sched);
  const perM = (x) => x * (loan?.termsPerYear || 4) / 12;
  const debt = loan ? loan.principal : home.debt || 0;
  const ltv = home.value ? debt / home.value : 0;
  const effRate = loan ? loan.rate + (loan.bidragPerTerm * loan.termsPerYear / loan.principal) * 100 : 0;
  const basePmt = sched.find((t) => t.afdrag > 0);

  // Månedlig økonomi for en terminsplan (første termin)
  const econ = (s) => {
    const t = s[0] || { interest: 0, bidrag: 0, afdrag: 0 };
    const rows = [
      ['Renter', perM(t.interest)],
      ['Bidrag', perM(t.bidrag)],
      ['Afdrag', perM(t.afdrag)],
      [`Skattefradrag (${fmt(FRADRAG_RATE * 100, 0)} %)`, -fradragsvaerdi(perM(t.interest + t.bidrag))],
      ...ownerCosts.map((f) => [f.name, perMonth(Number(f.amount), f.interval)]),
      ...utilities.map((f) => [f.name, perMonth(Number(f.amount), f.interval)]),
    ];
    return { rows, total: sum(rows, (r) => r[1]) };
  };
  const incomeRows = rentFixed.map((f) => [f.name + (f.until ? ` (til ${monthLabel(f.until)})` : ''), perMonth(Number(f.amount), f.interval)]);
  const incomeTotal = sum(incomeRows, (r) => r[1]);
  const net = (e) => e.total - incomeTotal;
  const netCell = (v) => `<b class="${v <= 0 ? 'pos' : ''}">${v <= 0 ? '+' : '−'}${kr(Math.abs(v))}</b>`;
  const amt = (v) => `${v < 0 ? '−' : ''}${kr(Math.abs(v))}`;
  // Tabel over boligens månedsøkonomi; med to planer vises de side om side
  const econTable = (cols) => `<table>
    ${cols.length > 1 ? `<thead><tr><th></th>${cols.map((c) => `<th class="num">${esc(c.name)}</th>`).join('')}</tr></thead>` : ''}
    <tbody>
      ${cols[0].e.rows.map(([l], i) => `<tr><td>${esc(l)}</td>${cols.map((c) => `<td class="num ${c.e.rows[i][1] < 0 ? 'pos' : ''}">${amt(c.e.rows[i][1])}</td>`).join('')}</tr>`).join('')}
      <tr><td><b>Udgifter i alt</b></td>${cols.map((c) => `<td class="num"><b>${kr(c.e.total)}</b></td>`).join('')}</tr>
      ${incomeRows.map(([l, v]) => `<tr><td>${esc(l)}</td>${cols.map(() => `<td class="num pos">−${kr(v)}</td>`).join('')}</tr>`).join('')}
      <tr><td><b>Resultat for dig</b> <span class="muted" style="font-size:12px">(+ = overskud)</span></td>${cols.map((c) => `<td class="num">${netCell(net(c.e))}</td>`).join('')}</tr>
    </tbody></table>
    ${ending.length ? `<p class="hint" style="margin-top:10px">${ending.map((f) => `Fra ${monthLabel(addMonths(f.until, 1))} falder ${esc(f.name)} (${kr(perMonth(Number(f.amount), f.interval))}) væk: ${cols.map((c) => `${cols.length > 1 ? esc(c.name).toLowerCase() + ' ' : ''}${net(c.e) + perMonth(Number(f.amount), f.interval) > 0 ? 'koster boligen dig' : 'giver boligen'} ${kr(Math.abs(net(c.e) + perMonth(Number(f.amount), f.interval)))} om måneden`).join(', ')}.`).join(' ')}</p>` : ''}`;

  // Scenariet (vises nederst)
  const reduction = HS.extraAmount / ((HS.kurs || 100) / 100);
  const scen = !loan || HS.scenario === 'none' ? null
    : HS.scenario === 'amortize' ? loanSchedule(loan, { ioUntil: null })
    : HS.scenario === 'extra' ? loanSchedule(loan, { extraNow: reduction, fixedPmt: HS.extraMode === 'loebetid' && basePmt ? basePmt.interest + basePmt.afdrag : null })
    : loanSchedule(loan, { rate: Number(HS.compareRate || loan.rate - 1) });
  const scenName = { amortize: 'Afdrag fra næste termin', extra: `Efter afdrag på ${kr(HS.extraAmount)}`, rate: `Rente ${fmt(Number(HS.compareRate || loan?.rate - 1), 2)} %` }[HS.scenario];

  // Betalingskalender
  const cal = loan ? housingCalendar(loan, sched, [...ownerCosts.map((f) => [f, 'owner']), ...utilities.map((f) => [f, 'util'])], rentFixed) : [];
  const calMonths = monthRange(nowM, addMonths(nowM, 11));
  const GROUPS = [['loan', `${loan?.lender || 'Realkredit'} (ydelse)`, series(0)], ['owner', 'Ejerforening m.m.', series(3)], ['util', 'Forsyning', series(2)]];
  const calOut = cal.filter((c) => c.group !== 'rent');

  el.innerHTML = `
    <div class="head">
      <div><h2>Bolig & lån</h2><div class="sub">${esc(home.name)}${loan ? ` · ${esc(loan.lender || 'Realkreditlån')}, ${loan.fixed ? 'fast' : 'variabel'} rente ${fmt(loan.rate, 2)} %` : ''}</div></div>
      ${homes.length > 1 ? `<select id="hSel">${homes.map((h) => `<option value="${h.id}" ${h.id === home.id ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select>` : ''}
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Boligværdi</div><div class="value">${kr(home.value)}</div><div class="delta"><a href="#formue">opdatér under Formue</a></div></div>
      <div class="card kpi"><div class="label">Restgæld</div><div class="value">${kr(debt)}</div><div class="delta">${loan ? 'pr. ' + dateLabel(loan.balanceDate) : ''}</div></div>
      <div class="card kpi"><div class="label">Friværdi</div><div class="value">${kr(home.value - debt)}</div><div class="delta">belåningsgrad ${pct(ltv, 0)}</div></div>
      ${loan ? `<div class="card kpi"><div class="label">Ydelse pr. måned nu</div><div class="value">${kr(perM(sched[0].payment))}</div><div class="delta">${kr(perM(sched[0].payment) - fradragsvaerdi(perM(sched[0].interest + sched[0].bidrag)))} efter fradrag</div></div>
      <div class="card kpi"><div class="label">Rente inkl. bidrag</div><div class="value">${fmt(effRate, 2)} %</div><div class="delta">${fmt(effRate * (1 - FRADRAG_RATE), 2)} % efter ${fmt(FRADRAG_RATE * 100, 0)} % fradrag</div></div>` : ''}
    </div>
    ${!loan || HS.editLoan ? loanForm(home) : ''}
    ${loan ? `
    ${loan.ioUntil ? `<div class="banner" style="background:var(--surface-2);color:var(--text)">Afdragsfrihed til <b>${dateLabel(loan.ioUntil)}</b> (${Math.floor(monthsBetween(nowM, loan.ioUntil.slice(0, 7)) / 12)} år og ${monthsBetween(nowM, loan.ioUntil.slice(0, 7)) % 12} mdr.). Derefter stiger ydelsen til ca. <b>${kr(perM((basePmt || sched[0]).payment))}</b> pr. måned før skat.</div>` : ''}

    <div class="grid cols-3-2">
      <div class="card">
        <div class="form-row" style="justify-content:space-between">
          <div><h3>Restgæld og boligværdi</h3><p class="hint" style="margin:0">Boligværdi fremskrevet med ${fmt(growth, 1)} % om året</p></div>
          <label>Værdistigning % p.a.<input type="number" step="0.5" id="hGrowth" value="${growth}" style="width:80px"></label>
        </div>
        <div class="legend" style="margin-top:10px"><span><i class="swatch" style="background:${series(0)}"></i>Boligværdi</span><span><i class="swatch" style="background:${series(1)}"></i>Restgæld</span></div>
        <div class="chart tall"><canvas id="cLoanBal"></canvas></div>
      </div>
      <div class="card">
        <h3>Boligens økonomi pr. måned</h3>
        <p class="hint">Lånet ud fra næste termin, øvrige poster og husleje fra dine faste poster.</p>
        ${econTable([{ name: 'Nu', e: econ(sched) }])}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Hvornår falder betalingerne?</h3>
      <p class="hint">Boligens betalinger de næste 12 måneder · datoer ud fra lånets terminer og dine seneste betalinger</p>
      <div class="legend">${GROUPS.map(([, l, c]) => `<span><i class="swatch" style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>
      <div class="chart short"><canvas id="cCal"></canvas></div>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Måned</th><th>Dato</th><th>Betaling</th><th class="num">Ud</th><th class="num">Husleje ind</th><th class="num">Netto for måneden</th></tr></thead>
        <tbody>${calMonths.map((m) => {
          const items = calOut.filter((c) => c.date.startsWith(m));
          const out = sum(items, (c) => c.amount);
          const inn = sum(cal.filter((c) => c.group === 'rent' && c.date.startsWith(m)), (c) => c.amount);
          const rows = items.length ? items : [{ date: '', name: '–', amount: 0 }];
          return rows.map((c, i) => `<tr${i === 0 ? ' style="border-top:2px solid var(--grid)"' : ''}>
            ${i === 0 ? `<td rowspan="${rows.length}" style="vertical-align:top;font-weight:600">${monthLabel(m)}</td>` : ''}
            <td class="muted" style="white-space:nowrap">${c.date ? dateShort(c.date) : ''}</td>
            <td>${esc(c.name)}${c.detail ? `<div class="muted" style="font-size:12px">${c.detail}</div>` : ''}</td>
            <td class="num">${c.amount ? kr(c.amount) : ''}</td>
            ${i === 0 ? `<td rowspan="${rows.length}" class="num pos" style="vertical-align:top">${inn ? '+' + kr(inn) : '–'}</td><td rowspan="${rows.length}" class="num" style="vertical-align:top"><b class="${inn - out >= 0 ? 'pos' : ''}">${inn - out >= 0 ? '+' : '−'}${kr(Math.abs(inn - out))}</b></td>` : ''}
          </tr>`).join('');
        }).join('')}</tbody>
      </table></div>
      <p class="hint" style="margin-top:8px">Beløb før skattefradrag. Betalingsservice trækker typisk beløbet første bankdag i måneden eller på terminsdatoen.</p>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>Ydelse pr. år</h3>
        <p class="hint">Renter, bidrag og afdrag før skat</p>
        <div class="legend"><span><i class="swatch" style="background:${series(0)}"></i>Renter</span><span><i class="swatch" style="background:${series(3)}"></i>Bidrag</span><span><i class="swatch" style="background:${series(2)}"></i>Afdrag</span></div>
        <div class="chart"><canvas id="cLoanYear"></canvas></div>
      </div>
      <div class="card">
        <h3>Faktisk: boligudgifter og lejeindtægter</h3>
        <p class="hint">Seneste 12 måneder fra dine posteringer (kategorierne Bolig og Lejeindtægt)</p>
        <div class="legend"><span><i class="swatch" style="background:${series(1)}"></i>Boligudgifter</span><span><i class="swatch" style="background:${series(2)}"></i>Lejeindtægter</span></div>
        <div class="chart"><canvas id="cRent"></canvas></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Hvad nu hvis …</h3>
      <p class="hint">Sammenlign lånet, som det er, med et scenarie</p>
      <div class="form-row" style="margin-top:10px">
        <label>Scenarie<select id="hScen">
          <option value="extra" ${HS.scenario === 'extra' ? 'selected' : ''}>Ekstraordinært afdrag</option>
          <option value="amortize" ${HS.scenario === 'amortize' ? 'selected' : ''}>Afdrag fra næste termin</option>
          <option value="rate" ${HS.scenario === 'rate' ? 'selected' : ''}>Anden rente (omlægning)</option>
          <option value="none" ${HS.scenario === 'none' ? 'selected' : ''}>Intet</option>
        </select></label>
        ${HS.scenario === 'extra' ? `
          <label>Beløb du betaler (kr.)<input type="number" step="10000" id="hExtra" value="${HS.extraAmount}" style="width:130px"></label>
          <label>Brug det til<select id="hMode"><option value="ydelse" ${HS.extraMode === 'ydelse' ? 'selected' : ''}>Lavere ydelse</option><option value="loebetid" ${HS.extraMode === 'loebetid' ? 'selected' : ''}>Kortere løbetid</option></select></label>
          <label title="Fastforrentede lån kan indfries til kurs 100 eller købes op til markedskursen, hvis den er lavere">Kurs<input type="number" step="0.5" id="hKurs" value="${HS.kurs}" style="width:80px"></label>` : ''}
        ${HS.scenario === 'rate' ? `<label>Ny rente %<input type="number" step="0.25" id="hRate" value="${HS.compareRate || loan.rate - 1}" style="width:80px"></label>` : ''}
      </div>
      ${HS.scenario === 'extra' ? `<p class="hint" style="margin:8px 0 0">Restgælden falder med ${kr(reduction)}${HS.kurs < 100 ? ` (du betaler ${kr(HS.extraAmount)} og køber obligationer op til kurs ${fmt(HS.kurs, 1)})` : ''} · Fastforrentede lån kan indfries til kurs 100 eller til markedskursen, hvis den er lavere – se den aktuelle kurs hos ${esc(loan.lender || 'långiveren')}. Gebyrer er ikke medregnet.</p>` : ''}
      ${scen ? `
      <div id="loanCompare" style="margin-top:12px"></div>
      <div class="grid cols-2" style="margin-top:16px">
        <div><h3>Boligens økonomi pr. måned</h3><p class="hint">Som nu og i scenariet</p>${econTable([{ name: 'Som nu', e: econ(sched) }, { name: scenName, e: econ(scen) }])}</div>
        <div><h3>Restgæld</h3><p class="hint">Stiplet = ${esc(scenName.toLowerCase())}</p><div class="chart"><canvas id="cScenBal"></canvas></div></div>
      </div>` : ''}
    </div>
    <p style="margin:16px 0 0"><button class="btn small" id="hEdit">Redigér lånoplysninger</button></p>` : ''}`;

  if ($('#hSel')) $('#hSel').onchange = (e) => { HS.assetId = e.target.value; render(); };
  bindLoanForm(home);
  if (!loan) return;
  const keepScroll = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
  $('#hEdit').onclick = () => { HS.editLoan = true; render(); window.scrollTo(0, 0); };
  $('#hGrowth').onchange = (e) => { HS.growth = Number(e.target.value); keepScroll(); };
  $('#hScen').onchange = (e) => { HS.scenario = e.target.value; keepScroll(); };
  if ($('#hRate')) $('#hRate').onchange = (e) => { HS.compareRate = Number(e.target.value); keepScroll(); };
  if ($('#hExtra')) $('#hExtra').onchange = (e) => { HS.extraAmount = Math.max(0, Number(e.target.value) || 0); keepScroll(); };
  if ($('#hMode')) $('#hMode').onchange = (e) => { HS.extraMode = e.target.value; keepScroll(); };
  if ($('#hKurs')) $('#hKurs').onchange = (e) => { HS.kurs = Math.min(100, Math.max(50, Number(e.target.value) || 100)); keepScroll(); };

  const years = yearly.map((y) => y.year);
  const startY = Number(years[0]);
  chart('cLoanBal', {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        { label: 'Boligværdi', data: years.map((y) => home.value * Math.pow(1 + growth / 100, Number(y) - startY + 1)), ...lineStyle(series(0)) },
        { label: 'Restgæld', data: yearly.map((y) => y.endBalance), ...lineStyle(series(1)) },
      ],
    },
    options: baseOptions(),
  });
  chart('cCal', {
    type: 'bar',
    data: {
      labels: calMonths.map(shortMonth),
      datasets: GROUPS.map(([g, l, c], i) => ({ label: l, data: calMonths.map((m) => sum(calOut.filter((x) => x.group === g && x.date.startsWith(m)), (x) => x.amount)), ...barStyle(c), borderRadius: i === GROUPS.length - 1 ? 4 : 0 })),
    },
    options: baseOptions({ stacked: true }),
  });
  chart('cLoanYear', {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        { label: 'Renter', data: yearly.map((y) => y.interest), ...barStyle(series(0)), borderRadius: 0 },
        { label: 'Bidrag', data: yearly.map((y) => y.bidrag), ...barStyle(series(3)), borderRadius: 0 },
        { label: 'Afdrag', data: yearly.map((y) => y.afdrag), ...barStyle(series(2)) },
      ],
    },
    options: baseOptions({ stacked: true }),
  });
  const last12 = monthRange(addMonths(nowM, -12), addMonths(nowM, -1));
  chart('cRent', {
    type: 'bar',
    data: {
      labels: last12.map(shortMonth),
      datasets: [
        { label: 'Boligudgifter', data: last12.map((m) => -sum(S.txs.filter((t) => t.date.startsWith(m) && t.category === 'Bolig' && t.amount < 0), (t) => t.amount)), ...barStyle(series(1)) },
        { label: 'Lejeindtægter', data: last12.map((m) => sum(S.txs.filter((t) => t.date.startsWith(m) && t.category === 'Lejeindtægt' && t.amount > 0), (t) => t.amount)), ...barStyle(series(2)) },
      ],
    },
    options: baseOptions(),
  });
  if (!scen) return;

  const scenY = byYear(scen);
  chart('cScenBal', {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        { label: 'Som nu', data: yearly.map((y) => y.endBalance), ...lineStyle(series(1)) },
        { label: scenName, data: years.map((y) => scenY.find((s) => s.year === y)?.endBalance ?? 0), ...lineStyle(series(1), { borderDash: [5, 4] }) },
      ],
    },
    options: baseOptions(),
  });

  // Nøgletal for lånet, sammenlignet med scenariet
  const totals = (s) => {
    const t0 = s[0] || { payment: 0, interest: 0, bidrag: 0 };
    const amort = s.find((t) => t.afdrag > 0);
    return {
      now: perM(t0.payment),
      nowAfterTax: perM(t0.payment) - fradragsvaerdi(perM(t0.interest + t0.bidrag)),
      later: amort ? perM(amort.payment) : null,
      firstAfdrag: amort?.date,
      interest: sum(s, (t) => t.interest + t.bidrag),
      afterTax: sum(s, (t) => t.interest + t.bidrag) * (1 - FRADRAG_RATE),
      paidOff: s.length ? s[s.length - 1].date : null,
    };
  };
  const a = totals(sched);
  const b = totals(scen);
  const diffCell = (d) => `<td class="num ${d < 0 ? 'pos' : d > 0 ? 'neg' : ''}">${d > 0 ? '+' : d < 0 ? '−' : ''}${kr(Math.abs(d))}</td>`;
  const row = (l, f, numKey) => `<tr><td class="muted">${l}</td><td class="num">${f(a)}</td><td class="num">${f(b)}</td>${numKey && a[numKey] != null && b[numKey] != null ? diffCell(b[numKey] - a[numKey]) : '<td></td>'}</tr>`;
  $('#loanCompare').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th></th><th class="num">Som nu</th><th class="num">${esc(scenName)}</th><th class="num">Forskel</th></tr></thead>
    <tbody>
      ${row('Ydelse pr. md. nu, før skat', (x) => kr(x.now), 'now')}
      ${row('Ydelse pr. md. nu, efter fradrag', (x) => kr(x.nowAfterTax), 'nowAfterTax')}
      ${row('Ydelse pr. md. når der afdrages, før skat', (x) => (x.later != null ? kr(x.later) : '–'), 'later')}
      ${row('Første afdrag', (x) => (x.firstAfdrag ? dateLabel(x.firstAfdrag) : '–'))}
      ${row('Renter + bidrag resten af løbetiden', (x) => kr(x.interest), 'interest')}
      ${row('Heraf efter fradrag', (x) => kr(x.afterTax), 'afterTax')}
      ${row('Lånet er betalt ud', (x) => (x.paidOff ? dateLabel(x.paidOff) : '–'))}
    </tbody></table></div>
    ${HS.scenario === 'extra' && HS.extraAmount > 0 ? `<p class="hint" style="margin-top:8px">Hver krone du afdrager, sparer dig for ca. <b>${fmt(effRate * (1 - FRADRAG_RATE) / ((HS.kurs || 100) / 100), 2)} %</b> om året i renter og bidrag efter fradrag – et sikkert "afkast", du kan sammenligne med andre muligheder i Portefølje-testen (som fast afkast). I alt sparer du ca. ${kr(a.afterTax - b.afterTax)} efter fradrag over lånets løbetid.</p>` : ''}
    <p class="hint">Bidragssatsen holdes uændret i hele perioden (i praksis falder den ofte, når belåningen falder). Ved omlægning er kurstab og gebyrer ikke medregnet.</p>`;
}

function loanForm(home) {
  const l = home.loan || { lender: '', termsPerYear: 4, fixed: true, balanceDate: new Date().toISOString().slice(0, 10) };
  return `<div class="card" style="margin-bottom:16px">
    <h3>${home.loan ? 'Redigér lån' : 'Tilføj realkreditlån'}</h3>
    <p class="hint">Tallene står på din låneoversigt hos realkreditinstituttet (fx Totalkredit, Nykredit eller Realkredit Danmark).</p>
    <div class="form-row">
      <label>Långiver<input type="text" id="lLender" value="${esc(l.lender || '')}" style="width:130px"></label>
      <label>Restgæld (kr.)<input type="number" id="lPrin" value="${l.principal ?? ''}" style="width:130px"></label>
      <label>Pr. dato<input type="date" id="lBalDate" value="${l.balanceDate || ''}"></label>
      <label>Rente %<input type="number" step="0.01" id="lRate" value="${l.rate ?? ''}" style="width:80px"></label>
      <label>Fast rente<select id="lFixed"><option value="1" ${l.fixed !== false ? 'selected' : ''}>Ja</option><option value="0" ${l.fixed === false ? 'selected' : ''}>Nej</option></select></label>
      <label>Bidrag pr. termin (kr.)<input type="number" id="lBidrag" value="${l.bidragPerTerm ?? ''}" style="width:110px" title="Efter evt. KundeKroner"></label>
      <label>Terminer pr. år<input type="number" id="lTerms" value="${l.termsPerYear ?? 4}" style="width:70px"></label>
      <label>Næste termin<input type="date" id="lNext" value="${l.nextTerm || ''}"></label>
      <label>Afdragsfri til<input type="date" id="lIO" value="${l.ioUntil || ''}"></label>
      <label>Lånet udløber<input type="date" id="lEnd" value="${l.endDate || ''}"></label>
      <label>Skattefradrag %<input type="number" step="1" id="lTax" value="${l.taxDeduction ?? 25}" style="width:80px"></label>
    </div>
    <p style="margin:12px 0 0"><button class="btn primary" id="lSave">Gem lån</button>${home.loan ? ' <button class="btn" id="lCancel">Annullér</button>' : ''}</p>
  </div>`;
}

function bindLoanForm(home) {
  if (!$('#lSave')) return;
  $('#lSave').onclick = async () => {
    const loan = {
      lender: $('#lLender').value, principal: $('#lPrin').value, balanceDate: $('#lBalDate').value, rate: $('#lRate').value,
      fixed: $('#lFixed').value === '1', bidragPerTerm: $('#lBidrag').value, termsPerYear: $('#lTerms').value,
      nextTerm: $('#lNext').value, ioUntil: $('#lIO').value || null, endDate: $('#lEnd').value,
      taxDeduction: $('#lTax').value,
    };
    if (!loan.principal || !loan.rate || !loan.endDate) return toast('Udfyld mindst restgæld, rente og udløbsdato');
    await api('PUT', `/api/assets/${home.id}`, { loan });
    HS.editLoan = false;
    await refresh();
    render();
  };
  if ($('#lCancel')) $('#lCancel').onclick = () => { HS.editLoan = false; render(); };
}

// ---------- Portefølje-test ----------

const PRESETS = [
  { name: '100 % globale aktier', holdings: [{ ticker: 'VT', name: 'Vanguard Total World Stock ETF', weight: 100 }] },
  { name: 'Klassisk 60/40', holdings: [{ ticker: 'VT', name: 'Vanguard Total World Stock ETF', weight: 60 }, { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', weight: 40 }] },
  { name: 'Aktier, obligationer, ejendom, guld', holdings: [{ ticker: 'VT', name: 'Vanguard Total World Stock ETF', weight: 55 }, { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', weight: 25 }, { ticker: 'VNQ', name: 'Vanguard Real Estate ETF', weight: 10 }, { ticker: 'GLD', name: 'SPDR Gold Shares', weight: 10 }] },
  { name: 'Permanent portfolio-idé', holdings: [{ ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', weight: 25 }, { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', weight: 25 }, { ticker: 'GLD', name: 'SPDR Gold Shares', weight: 25 }, { ticker: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', weight: 25 }] },
];

function viewPortfolio(el) {
  const b = S.bt;
  const total = sum(b.holdings, (h) => Number(h.weight) || 0);
  const saved = S.state.portfolios;
  const avg = S.txs.length ? avgStats(addMonths(lastFullMonth(), 1), 3) : null;
  const surplus = avg ? Math.max(0, Math.round((avg.income - avg.spend) / 100) * 100) : null;

  el.innerHTML = `
    <div class="head"><div><h2>Portefølje-test</h2><div class="sub">Byg kombinationer og se, hvordan de historisk ville have klaret sig – omregnet til kroner</div></div></div>
    ${!S.state.hasPriceKey ? `<div class="banner"><b>Kursdata mangler:</b> Tilføj en gratis nøgle fra <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">Alpha Vantage</a> som <code>ALPHAVANTAGE_API_KEY</code> i <code>.env</code> og genstart. Indtil da virker kun faste afkast (lejlighed, kunst) og egne uploadede kursserier.</div>` : ''}
    <div class="grid cols-3-2">
      <div class="card">
        <div class="form-row" style="justify-content:space-between;align-items:center">
          <input type="text" id="pName" value="${esc(b.name)}" style="font-weight:600;flex:1">
          <span class="${Math.abs(total - 100) < 0.01 ? 'pos' : 'neg'}" style="font-weight:600">${fmt(total, 0)} %</span>
        </div>
        <div style="margin-top:12px">
          ${b.holdings.map((h, i) => `<div class="holding">
            <div style="min-width:0"><div class="tk">${esc(h.ticker)}</div><div class="nm" title="${esc(h.name || '')}">${esc(h.name || '')}${h.currency ? ' · ' + h.currency : ''}</div></div>
            <input type="number" value="${h.weight}" data-w="${i}" style="text-align:right" aria-label="Vægt i procent">
            <span class="muted">%</span>
            <button class="btn small ghost danger" data-rm="${i}" title="Fjern">✕</button>
          </div>`).join('') || '<p class="muted">Tilføj aktiver herunder, eller start fra et eksempel.</p>'}
        </div>
        <div style="margin-top:12px;position:relative">
          <input type="search" id="tSearch" placeholder="Søg fond/ETF/aktie (fx MSCI World, Novo, VT)…" style="width:100%">
          <div id="tResults"></div>
        </div>
        <div class="filters" style="margin-top:10px">
          <button class="btn small" id="addFixed">+ Fast afkast (fx bolig)</button>
          <button class="btn small" id="addMine" ${S.state.assets.some((a) => a.expectedReturn != null) ? '' : 'disabled'} title="Tilføjer aktiver med forventet afkast (angives under Formue)">+ Min formue (bolig, kunst …)</button>
          ${S.state.customSeries.map((c) => `<button class="btn small" data-custom="${c.id}">+ ${esc(c.name)}</button>`).join('')}
        </div>
        <div class="filters" style="margin-top:4px">
          <button class="btn small" id="even" ${b.holdings.length ? '' : 'disabled'}>Fordel ligeligt</button>
          <button class="btn small" id="norm" ${b.holdings.length && Math.abs(total - 100) > 0.01 ? '' : 'disabled'}>Skalér til 100 %</button>
          <span style="flex:1"></span>
          <button class="btn small" id="pNew">Ny</button>
          <button class="btn small primary" id="pSave" ${b.holdings.length ? '' : 'disabled'}>${b.id ? 'Gem ændringer' : 'Gem portefølje'}</button>
        </div>
        <details style="margin-top:10px"><summary>Lærebogseksempler at starte fra</summary>
          <p class="hint" style="margin-top:6px">Klassiske, generelle sammensætninger brugt i undervisning – ikke personlige anbefalinger.</p>
          <div class="filters">${PRESETS.map((p, i) => `<button class="btn small" data-preset="${i}">${esc(p.name)}</button>`).join('')}</div>
        </details>
      </div>

      <div class="stack">
        <div class="card">
          <h3>Gemte porteføljer</h3>
          <p class="hint">Markér op til 4 for at sammenligne dem.</p>
          ${saved.length ? saved.map((p) => `<div class="filters" style="margin-bottom:6px">
            <label style="display:flex;gap:8px;align-items:center;flex:1;min-width:0"><input type="checkbox" data-cmp="${p.id}" ${b.compare.has(p.id) ? 'checked' : ''}> <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span></label>
            <span class="muted" style="font-size:12px">${p.holdings.map((h) => h.ticker.replace(/^EGEN:.*/, 'egen')).join(' · ')}</span>
            <button class="btn small ghost" data-load="${p.id}">Åbn</button>
            <button class="btn small ghost danger" data-pdel="${p.id}" title="Slet">✕</button>
          </div>`).join('') : '<p class="muted">Ingen gemte endnu.</p>'}
        </div>
        <div class="card">
          <h3>Forudsætninger</h3>
          <div class="form-row" style="margin-top:10px">
            <label>Periode<select id="bYears">${[['5', '5 år'], ['10', '10 år'], ['15', '15 år'], ['20', '20 år'], ['max', 'Længst mulig']].map(([v, l]) => `<option value="${v}" ${v === b.years ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label>Startbeløb<input type="number" id="bInit" value="${b.initial}" style="width:120px"></label>
            <label>Indskud pr. md.<input type="number" id="bMonthly" value="${b.monthly}" style="width:110px"></label>
          </div>
          <div style="margin-top:10px">
            ${b.extra.map((e, i) => `<div class="form-row" style="margin-bottom:6px">
              <label>Engangsindskud<input type="number" value="${e.amount}" data-ex="${i}" data-exk="amount" style="width:120px"></label>
              <label>efter antal mdr.<input type="number" min="1" value="${e.after}" data-ex="${i}" data-exk="after" style="width:80px"></label>
              <button class="btn small ghost danger" data-exrm="${i}" title="Fjern">✕</button>
            </div>`).join('')}
            <button class="btn small" id="exAdd">+ Engangsindskud</button>
          </div>
          ${surplus ? `<p class="hint" style="margin:6px 0 0">Dit gennemsnitlige overskud de seneste ${avg.n} mdr. er ${kr(surplus)}. <a href="#" id="useSurplus">Brug som indskud</a></p>` : ''}
          <div class="form-row" style="margin-top:10px">
            <label>Rebalancering<select id="bReb"><option value="yearly" ${b.rebalance === 'yearly' ? 'selected' : ''}>Årligt</option><option value="monthly" ${b.rebalance === 'monthly' ? 'selected' : ''}>Månedligt</option><option value="none" ${b.rebalance === 'none' ? 'selected' : ''}>Aldrig</option></select></label>
            <label>Sammenlign med<input type="text" id="bBench" value="${esc(b.benchmark)}" style="width:110px" placeholder="fx VT"></label>
          </div>
          <p style="margin:14px 0 0"><button class="btn primary" id="run" ${b.holdings.length || b.compare.size ? '' : 'disabled'}>Kør backtest</button> <span class="muted" id="runInfo"></span></p>
        </div>
      </div>
    </div>
    <div id="btOut"></div>
    <details class="card" style="margin-top:16px">
      <summary>Upload egen kursserie (fx dansk investeringsforening eller boligprisindeks)</summary>
      <p class="hint" style="margin-top:8px">CSV med én række pr. dato: <code>dato;kurs</code>. Hent fx kurshistorik fra fondens hjemmeside eller boligpriser fra Danmarks Statistik.</p>
      <div class="form-row">
        <label>Navn<input type="text" id="sName" placeholder="fx Sparinvest Index Globale Aktier"></label>
        <label>Valuta<select id="sCur"><option>DKK</option><option>EUR</option><option>USD</option><option>SEK</option><option>NOK</option><option>GBP</option></select></label>
        <label>Fil<input type="file" id="sFile" accept=".csv,.txt"></label>
        <button class="btn" id="sUp">Upload</button>
      </div>
      ${S.state.customSeries.length ? `<p class="hint" style="margin-top:10px">Uploadet: ${S.state.customSeries.map((c) => `${esc(c.name)} (${c.months} mdr. fra ${c.from}) <a href="#" data-sdel="${c.id}">slet</a>`).join(' · ')}</p>` : ''}
    </details>`;

  const keep = () => {
    b.name = $('#pName').value;
    b.years = $('#bYears').value;
    b.initial = Number($('#bInit').value) || 0;
    b.monthly = Number($('#bMonthly').value) || 0;
    b.rebalance = $('#bReb').value;
    b.benchmark = $('#bBench').value.trim();
  };
  const rerender = () => { keep(); render(); };
  $$('#pName, #bYears, #bInit, #bMonthly, #bReb, #bBench').forEach((i) => (i.onchange = keep));
  $$('[data-w]').forEach((i) => (i.onchange = () => { b.holdings[i.dataset.w].weight = Number(i.value) || 0; rerender(); }));
  $$('[data-rm]').forEach((x) => (x.onclick = () => { b.holdings.splice(Number(x.dataset.rm), 1); rerender(); }));
  $$('[data-preset]').forEach((x) => (x.onclick = () => { const p = PRESETS[x.dataset.preset]; keep(); Object.assign(b, { name: p.name, holdings: structuredClone(p.holdings), id: null }); render(); }));
  $$('[data-custom]').forEach((x) => (x.onclick = () => { const c = S.state.customSeries.find((s) => s.id === x.dataset.custom); b.holdings.push({ ticker: 'EGEN:' + c.id, name: c.name, weight: 0 }); rerender(); }));
  $('#addFixed').onclick = () => {
    const r = prompt('Fast årligt afkast i procent (fx 3 for en lejlighed med forventet 3 % værdistigning):', '3');
    if (r == null || isNaN(Number(r.replace(',', '.')))) return;
    const v = Number(r.replace(',', '.'));
    b.holdings.push({ ticker: `FAST:${v}`, name: `Fast afkast ${fmt(v, 1)} % p.a.`, weight: 0 });
    rerender();
  };
  $('#addMine').onclick = () => {
    // Formuens aktiver med forventet afkast, vægtet efter nettoværdi. Depoter o.l. uden forventet
    // afkast springes over – dem modellerer man bedre med de faktiske fonde.
    const list = S.state.assets.filter((a) => a.value - (a.debt || 0) > 0 && a.expectedReturn != null);
    const skipped = S.state.assets.filter((a) => a.expectedReturn == null).map((a) => a.name);
    const tot = sum(list, (a) => a.value - (a.debt || 0));
    for (const a of list) {
      b.holdings.push({ ticker: `FAST:${a.expectedReturn}`, name: `${a.name} (${fmt(a.expectedReturn, 1)} % p.a.)`, weight: Math.round(((a.value - (a.debt || 0)) / tot) * 100) });
    }
    rerender();
    toast(list.length ? `Tilføjet med vægt efter nettoværdi.${skipped.length ? ` Uden forventet afkast (sprunget over): ${esc(skipped.join(', '))} – tilføj de faktiske fonde i stedet.` : ''}` : 'Ingen aktiver har et forventet afkast. Angiv det under Formue.', [], 9000);
  };
  $('#even').onclick = () => { const w = Math.round((100 / b.holdings.length) * 100) / 100; b.holdings.forEach((h) => (h.weight = w)); rerender(); };
  $('#norm').onclick = () => { b.holdings.forEach((h) => (h.weight = Math.round((h.weight / total) * 10000) / 100)); rerender(); };
  $('#pNew').onclick = () => { Object.assign(b, { name: 'Min portefølje', holdings: [], id: null }); render(); };
  $('#pSave').onclick = async () => {
    keep();
    const body = { name: b.name, holdings: b.holdings };
    const p = b.id ? await api('PUT', `/api/portfolios/${b.id}`, body) : await api('POST', '/api/portfolios', body);
    b.id = p.id;
    if (b.compare.size < 4) b.compare.add(p.id);
    await refresh();
    render();
    toast('Porteføljen er gemt.');
  };
  $$('[data-load]').forEach((x) => (x.onclick = () => { const p = saved.find((s) => s.id === x.dataset.load); keep(); Object.assign(b, { name: p.name, holdings: structuredClone(p.holdings), id: p.id }); render(); }));
  $$('[data-pdel]').forEach((x) => (x.onclick = async () => { if (!confirm('Slet porteføljen?')) return; await api('DELETE', `/api/portfolios/${x.dataset.pdel}`); b.compare.delete(x.dataset.pdel); if (b.id === x.dataset.pdel) b.id = null; await refresh(); render(); }));
  $$('[data-cmp]').forEach((x) => (x.onchange = () => {
    if (x.checked && b.compare.size >= 4) { x.checked = false; return toast('Højst 4 porteføljer ad gangen'); }
    x.checked ? b.compare.add(x.dataset.cmp) : b.compare.delete(x.dataset.cmp);
    rerender();
  }));
  $$('[data-ex]').forEach((i) => (i.onchange = () => { b.extra[i.dataset.ex][i.dataset.exk] = Number(i.value) || 0; }));
  $$('[data-exrm]').forEach((x) => (x.onclick = () => { keep(); b.extra.splice(Number(x.dataset.exrm), 1); render(); }));
  $('#exAdd').onclick = () => { keep(); b.extra.push({ amount: 100000, after: 12 }); render(); };
  if ($('#useSurplus')) $('#useSurplus').onclick = (e) => { e.preventDefault(); $('#bMonthly').value = surplus; keep(); };

  let timer;
  $('#tSearch').oninput = (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    const box = $('#tResults');
    if (q.length < 2) { box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const res = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
        const direct = /^[A-Z0-9.^=-]{1,15}$/i.test(q) ? [{ symbol: q.toUpperCase(), name: 'Brug symbolet direkte', exchange: '' }] : [];
        const all = [...res, ...direct.filter((d) => !res.some((r) => r.symbol === d.symbol))];
        box.innerHTML = `<div class="search-results">${all.map((r, i) => `<button data-pick="${i}"><b>${esc(r.symbol)}</b> <span class="muted">${esc(r.name)} · ${esc(r.exchange || '')}${r.currency ? ' · ' + esc(r.currency) : ''}</span></button>`).join('') || '<div class="muted" style="padding:8px">Ingen resultater</div>'}</div>`;
        $$('[data-pick]', box).forEach((x) => (x.onclick = () => {
          const r = all[x.dataset.pick];
          b.holdings.push({ ticker: r.symbol, name: r.name === 'Brug symbolet direkte' ? '' : r.name, currency: r.currency || undefined, weight: 0 });
          rerender();
        }));
      } catch (err) {
        box.innerHTML = `<div class="search-results"><div class="muted" style="padding:8px">${esc(err.message)}</div></div>`;
      }
    }, 350);
  };

  $('#sUp').onclick = async () => {
    const file = $('#sFile').files[0];
    if (!file) return toast('Vælg en fil');
    try {
      const r = await api('POST', '/api/series', { name: $('#sName').value || file.name.replace(/\.\w+$/, ''), currency: $('#sCur').value, text: await readText(file) });
      await refresh(); render();
      toast(`${esc(r.name)}: ${r.months} måneder indlæst.`);
    } catch (e) { toast(esc(e.message)); }
  };
  $$('[data-sdel]').forEach((x) => (x.onclick = async (e) => { e.preventDefault(); await api('DELETE', `/api/series/${x.dataset.sdel}`); await refresh(); render(); }));

  $('#run').onclick = async () => {
    keep();
    const ports = [];
    if (b.holdings.length && !(b.id && b.compare.has(b.id))) ports.push({ name: b.name + (b.id ? '' : ' (ikke gemt)'), holdings: b.holdings });
    for (const id of b.compare) { const p = saved.find((s) => s.id === id); if (p) ports.push({ name: p.name, holdings: id === b.id ? b.holdings : p.holdings }); }
    if (ports.some((p) => Math.abs(sum(p.holdings, (h) => Number(h.weight)) - 100) > 0.5)) toast('Bemærk: vægtene summerer ikke til 100 % – de skaleres automatisk.');
    $('#runInfo').textContent = 'Henter kurser og regner …';
    $('#run').disabled = true;
    try {
      b.result = await api('POST', '/api/backtest', { portfolios: ports.slice(0, 4), benchmark: b.benchmark || null, years: b.years, initial: b.initial, monthly: b.monthly, extra: b.extra, rebalance: b.rebalance });
      $('#runInfo').textContent = '';
      renderBacktest();
    } catch (e) {
      $('#runInfo').innerHTML = `<span class="neg">${esc(e.message)}</span>`;
    } finally {
      $('#run').disabled = false;
    }
  };
  if (b.result) renderBacktest();
}

function renderBacktest() {
  const r = S.bt.result;
  const all = [...r.results, ...(r.benchmark ? [{ ...r.benchmark, name: `Sammenligning: ${r.benchmark.ticker}`, isBench: true }] : [])];
  const color = (i, x) => (x.isBench ? css('--muted') : series(i));
  const m = (x) => x.metrics;
  const row = (label, f, cls) => `<tr><td class="muted">${label}</td>${all.map((x) => `<td class="num ${cls ? cls(x) : ''}">${f(x)}</td>`).join('')}</tr>`;

  $('#btOut').innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3>Resultat ${monthLabel(r.from)} – ${monthLabel(r.to)}</h3>
      <p class="hint">${r.months} måneder · alle beløb i DKK · før skat og handelsomkostninger${r.limitedBy ? ` · perioden er afkortet, fordi ${esc(r.limitedBy.symbol)} kun har data fra ${monthLabel(r.limitedBy.from)}` : ''}</p>
      <div class="table-wrap"><table>
        <thead><tr><th></th>${all.map((x, i) => `<th class="num"><i class="swatch" style="background:${color(i, x)}"></i>${esc(x.name)}</th>`).join('')}</tr></thead>
        <tbody>
          ${row('Slutværdi', (x) => kr(m(x).finalValue))}
          ${row('Indskudt i alt', (x) => kr(m(x).contributed))}
          ${row('Gevinst', (x) => kr(m(x).gain), (x) => signClass(m(x).gain))}
          ${row('Årligt afkast (CAGR)', (x) => pct(m(x).cagr), (x) => signClass(m(x).cagr))}
          ${row('Udsving (volatilitet p.a.)', (x) => pct(m(x).volatility))}
          ${row('Største fald fra top', (x) => pct(m(x).maxDrawdown), () => 'neg')}
          ${row('Afkast pr. risiko', (x) => (m(x).ratio == null ? '–' : fmt(m(x).ratio, 2)))}
          ${row('Bedste år', (x) => (m(x).best ? `${pct(m(x).best.return, 0)} (${m(x).best.year})` : '–'))}
          ${row('Værste år', (x) => (m(x).worst ? `${pct(m(x).worst.return, 0)} (${m(x).worst.year})` : '–'))}
        </tbody>
      </table></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Værdi over tid</h3>
      <p class="hint">Med startbeløb, månedlige indskud og engangsindskud · stiplet grå = indskudt beløb</p>
      <div class="legend">${all.map((x, i) => `<span><i class="swatch" style="background:${color(i, x)}"></i>${esc(x.name)}</span>`).join('')}</div>
      <div class="chart tall"><canvas id="cBtVal"></canvas></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Fald fra seneste top</h3><p class="hint">Hvor dybt og hvor længe porteføljen var under sit tidligere højdepunkt</p><div class="chart"><canvas id="cBtDD"></canvas></div></div>
      <div class="card"><h3>Afkast pr. kalenderår</h3><p class="hint">Første og sidste år kan være delvise</p><div class="chart"><canvas id="cBtYr"></canvas></div></div>
    </div>
    ${r.correlation.assets.length > 1 ? `<div class="card" style="margin-top:16px">
      <h3>Hvor ens bevæger aktiverne sig?</h3>
      <p class="hint">Korrelation af månedsafkast: 1 = følges ad, 0 = uafhængige, −1 = modsat. Lav korrelation giver mere spredning.</p>
      <div class="table-wrap"><table class="heat"><thead><tr><th></th>${r.correlation.assets.map((a) => `<th class="num">${esc(a)}</th>`).join('')}</tr></thead>
      <tbody>${r.correlation.matrix.map((row, i) => `<tr><th>${esc(r.correlation.assets[i])}</th>${row.map((v) => `<td style="background:${corrColor(v)};color:${Math.abs(v) > 0.55 ? '#fff' : 'inherit'}">${fmt(v, 2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </div>` : ''}
    <p class="hint" style="margin-top:12px">Historiske afkast er ingen garanti for fremtidige. Faste afkast (fx bolig) har intet udsving i modellen og får derfor porteføljen til at se mere stabil ud, end den er. Dansk beskatning (lager-/realisationsbeskatning, aktiesparekonto, pension) er ikke medregnet.</p>`;

  const labels = all[0].points.map((p) => shortMonth(p.month));
  const opts = baseOptions({ legend: false });
  chart('cBtVal', {
    type: 'line',
    data: {
      labels,
      datasets: [
        ...all.map((x, i) => ({ label: x.name, data: x.points.map((p) => p.value), ...lineStyle(color(i, x), x.isBench ? { borderDash: [5, 4] } : {}) })),
        { label: 'Indskudt', data: all[0].points.map((p) => p.contributed), ...lineStyle(css('--axis'), { borderDash: [2, 3], borderWidth: 1.5 }) },
      ],
    },
    options: opts,
  });
  chart('cBtDD', {
    type: 'line',
    data: { labels, datasets: all.map((x, i) => ({ label: x.name, data: x.metrics.drawdown.map((d) => d.dd), ...lineStyle(color(i, x), x.isBench ? { borderDash: [5, 4] } : {}) })) },
    options: (() => { const o = baseOptions({ percent: true }); o.scales.y.max = 0; return o; })(),
  });
  const years = all[0].metrics.annual.map((a) => a.year);
  chart('cBtYr', {
    type: 'bar',
    data: { labels: years, datasets: all.map((x, i) => ({ label: x.name, data: x.metrics.annual.map((a) => a.return), ...barStyle(color(i, x)), borderSkipped: false })) },
    options: baseOptions({ percent: true }),
  });
}

// Divergerende skala: rød (negativ) – grå – blå (positiv)
function corrColor(v) {
  const t = Math.max(-1, Math.min(1, v));
  const mid = css('--neutral-mid');
  const pole = t >= 0 ? '#2a78d6' : '#d03b3b';
  const a = Math.abs(t);
  const mix = (c1, c2) => {
    const p = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
    return `rgb(${[0, 1, 2].map((i) => Math.round(p(c1, i) * (1 - a) + p(c2, i) * a)).join(',')})`;
  };
  return mix(mid.startsWith('#') ? mid : '#f0efec', pole);
}

// ---------- Indstillinger ----------

async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

function viewSettings(el) {
  const st = S.state;
  const e = st.eb;
  const flag = location.hash.includes('bank=ok') ? '<div class="banner" style="background:var(--surface-2);color:var(--good)">Banken er forbundet, og posteringerne er hentet.</div>'
    : location.hash.includes('bank=fejl') ? `<div class="banner">Forbindelsen til banken fejlede: ${esc(e.lastError || 'ukendt fejl')}</div>` : '';

  el.innerHTML = `
    <div class="head"><div><h2>Indstillinger</h2><div class="sub">Konti, bankforbindelse, import og regler</div></div></div>
    ${flag}
    <div class="grid cols-2">
      <div class="stack">
        <div class="card">
          <h3>Bankforbindelse</h3>
          <p class="hint">Automatisk hentning via PSD2 gennem Enable Banking. Du godkender med MitID i bankens eget vindue; adgangen gælder op til 90 dage ad gangen.</p>
          ${!e.configured ? `
            <ol class="steps">
              <li>Opret en gratis konto på <a href="https://enablebanking.com/sign-in/" target="_blank" rel="noopener">enablebanking.com</a> og gå til <b>Control Panel → API applications</b>.</li>
              <li>Opret en applikation i miljøet <b>Production</b> til eget brug. Som redirect-URL angives:<br><code>${esc(e.redirectUrl)}</code></li>
              <li>Gem den private nøgle (.pem), som bliver genereret, som <code>${esc(e.keyPath)}</code> i projektmappen. ${e.hasKey ? '<span class="pos">✓ fundet</span>' : '<span class="neg">mangler</span>'}</li>
              <li>Indsæt applikationens ID i <code>.env</code> som <code>ENABLE_BANKING_APP_ID</code>. ${e.hasAppId ? '<span class="pos">✓ fundet</span>' : '<span class="neg">mangler</span>'}</li>
              <li>Aktivér applikationen ved at linke dine egne konti i kontrolpanelet, og genstart dashboardet.</li>
            </ol>` : e.connected ? `
            <p><b>${esc(e.bank || 'Bank')}</b> er forbundet${e.validUntil ? ` · adgang til ${dateLabel(e.validUntil.slice(0, 10))}` : ''}.<br>
            <span class="muted">Senest hentet: ${e.lastSync ? new Date(e.lastSync).toLocaleString('da-DK') : 'aldrig'} · henter automatisk hver 6. time, mens dashboardet kører.</span></p>
            ${e.lastError ? `<p class="neg">Seneste fejl: ${esc(e.lastError)}</p>` : ''}
            <p><button class="btn primary" id="ebSync">Hent nu</button> <button class="btn" id="ebRenew">Forny adgang</button> <button class="btn ghost danger" id="ebOff">Afbryd</button></p>` : ''}
          ${e.configured && !e.connected ? '<p>Klar til at forbinde.</p>' : ''}
          ${e.configured ? `<div id="ebConnect" ${e.connected ? 'hidden' : ''}>
            <div class="form-row"><label style="flex:1">Bank<select id="ebBank" style="width:100%"><option>Henter banker …</option></select></label><button class="btn primary" id="ebStart">Forbind med MitID</button></div>
            <details style="margin-top:10px"><summary>Kom du ikke automatisk tilbage efter MitID?</summary>
              <p class="hint" style="margin-top:6px">Kopiér hele adressen fra browserens adresselinje efter godkendelsen og indsæt den her.</p>
              <div class="form-row"><input type="text" id="ebCode" placeholder="https://…?code=…" style="flex:1"><button class="btn" id="ebCodeBtn">Fortsæt</button></div>
            </details>
          </div>` : ''}
        </div>

        <div class="card">
          <h3>Importér CSV fra netbank</h3>
          <p class="hint">I de fleste netbanker: vælg kontoen → <b>Posteringer</b> → vælg periode → <b>Eksportér / Gem som CSV</b>. Dubletter springes automatisk over.</p>
          <div class="form-row" style="margin-bottom:10px">
            <label style="flex:1">Til konto<select id="impAcc"><option value="">+ Ny konto</option>${st.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
            <label style="flex:1" id="impNameWrap">Navn på ny konto<input type="text" id="impName" placeholder="fx Lønkonto"></label>
          </div>
          <div class="drop" id="drop">Træk en CSV-fil hertil eller <u>vælg fil</u><input type="file" id="impFile" accept=".csv,.txt" hidden></div>
          <p id="impOut" class="hint" style="margin-top:8px"></p>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h3>Konti</h3>
          ${st.accounts.length ? `<table><tbody>${st.accounts.map((a) => `<tr>
            <td><input type="text" value="${esc(a.name)}" data-acc="${a.id}" style="width:100%"></td>
            <td class="muted" style="font-size:12px">${{ enablebanking: 'Bank (auto)', csv: 'CSV', demo: 'Demo' }[a.source] || a.source}</td>
            <td class="num">${kr(a.balance || 0)}</td>
            <td><button class="btn small ghost" data-bal="${a.id}" title="Ret saldo">Ret saldo</button></td>
            <td><button class="btn small ghost danger" data-accdel="${a.id}" title="Slet konto og posteringer">✕</button></td>
          </tr>`).join('')}</tbody></table>` : '<p class="muted">Ingen konti endnu.</p>'}
        </div>

        <div class="card">
          <h3>Kategoriregler</h3>
          <p class="hint">Oprettes, når du vælger "Gælder alle" efter at have ændret en kategori. Dine regler går forud for standardreglerne.</p>
          ${st.rules.length ? `<table><tbody>${st.rules.map((r, i) => `<tr><td>"${esc(r.match)}"${r.direction ? ` <span class="pill">${r.direction === 'in' ? 'ind' : 'ud'}</span>` : ''}${r.from || r.to ? ` <span class="muted" style="font-size:12px">${r.from ? dateShort(r.from) : ''}–${r.to ? dateShort(r.to) : ''}</span>` : ''}</td><td>→ ${esc(r.category)}</td><td><button class="btn small ghost danger" data-rule="${i}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ingen egne regler endnu.</p>'}
          <p style="margin:10px 0 0"><button class="btn small" id="recat">Kategorisér alle posteringer igen</button></p>
        </div>

        <div class="card">
          <h3>Kursdata til portefølje-test</h3>
          <p>${st.hasPriceKey ? '<span class="pos">✓ Alpha Vantage-nøgle fundet.</span>' : '<span class="neg">Ingen nøgle.</span> Hent en gratis på <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener">alphavantage.co</a> og sæt den i <code>.env</code> som <code>ALPHAVANTAGE_API_KEY</code>.'}</p>
          <p class="hint">Gratisnøglen giver 25 opslag i døgnet. Hentede kurser gemmes lokalt i 3 dage.</p>
        </div>

        <div class="card">
          <h3>Demodata</h3>
          <p class="hint">Fiktive posteringer, en lejlighed, et depot og et kunstværk – til at prøve dashboardet.</p>
          ${st.hasDemo ? '<button class="btn danger" id="demoOff">Fjern demodata</button>' : '<button class="btn" id="demoOn">Indlæs demodata</button>'}
        </div>
      </div>
    </div>`;

  // Bank
  if (e.configured && $('#ebBank')) {
    api('GET', '/api/eb/banks').then((banks) => {
      const sel = $('#ebBank');
      if (!sel) return;
      sel.innerHTML = banks.map((b) => `<option>${esc(b.name)}</option>`).join('');
    }).catch((err) => { const sel = $('#ebBank'); if (sel) sel.innerHTML = `<option>Fejl: ${esc(err.message)}</option>`; });
    $('#ebStart').onclick = async () => {
      try { const { url } = await api('POST', '/api/eb/start', { bank: $('#ebBank').value }); location.href = url; }
      catch (err) { toast(esc(err.message)); }
    };
    $('#ebCodeBtn').onclick = async () => {
      try { const r = await api('POST', '/api/eb/code', { input: $('#ebCode').value }); await refresh(); location.hash = 'indstillinger?bank=ok'; render(); toast(`${r.added} posteringer hentet.`); }
      catch (err) { toast(esc(err.message)); }
    };
  }
  if ($('#ebSync')) $('#ebSync').onclick = async () => {
    $('#ebSync').disabled = true;
    try { const r = await api('POST', '/api/eb/sync'); await refresh(); render(); toast(`${r.added} nye posteringer.`); }
    catch (err) { toast(esc(err.message)); await refresh(); render(); }
  };
  if ($('#ebRenew')) $('#ebRenew').onclick = () => { $('#ebConnect').hidden = false; };
  if ($('#ebOff')) $('#ebOff').onclick = async () => { if (!confirm('Afbryd bankforbindelsen? Posteringerne bliver liggende.')) return; await api('DELETE', '/api/eb'); await refresh(); render(); };

  // Import
  const impAcc = $('#impAcc');
  impAcc.onchange = () => { $('#impNameWrap').hidden = !!impAcc.value; };
  const drop = $('#drop');
  const doImport = async (file) => {
    $('#impOut').textContent = 'Indlæser …';
    try {
      const r = await api('POST', '/api/import/csv', { text: await readText(file), fileName: file.name.replace(/\.\w+$/, ''), accountId: impAcc.value || null, accountName: $('#impName').value.trim() || null });
      await refresh();
      render();
      toast(`${r.added} nye posteringer importeret til ${esc(r.account.name)}${r.skipped ? ` (${r.skipped} fandtes allerede)` : ''}.`);
    } catch (err) {
      $('#impOut').innerHTML = `<span class="neg">${esc(err.message)}</span>`;
    }
  };
  drop.onclick = () => $('#impFile').click();
  $('#impFile').onchange = (ev) => ev.target.files[0] && doImport(ev.target.files[0]);
  drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (ev) => { ev.preventDefault(); drop.classList.remove('over'); if (ev.dataTransfer.files[0]) doImport(ev.dataTransfer.files[0]); };

  // Konti
  $$('[data-acc]').forEach((i) => (i.onchange = async () => { await api('PUT', `/api/accounts/${i.dataset.acc}`, { name: i.value }); await refresh(); }));
  $$('[data-bal]').forEach((b) => (b.onclick = async () => {
    const v = prompt('Aktuel saldo i kr.:');
    if (v == null || v === '') return;
    await api('PUT', `/api/accounts/${b.dataset.bal}`, { balance: Number(v.replace(/\./g, '').replace(',', '.')) });
    await refresh(); render();
  }));
  $$('[data-accdel]').forEach((b) => (b.onclick = async () => { if (!confirm('Slet kontoen og alle dens posteringer?')) return; await api('DELETE', `/api/accounts/${b.dataset.accdel}`); await refresh(); render(); }));

  // Regler og demo
  $$('[data-rule]').forEach((b) => (b.onclick = async () => { await api('DELETE', `/api/rules/${b.dataset.rule}`); await refresh(); render(); }));
  $('#recat').onclick = async () => { await api('POST', '/api/recategorize'); await refresh(); render(); toast('Alle posteringer er kategoriseret igen.'); };
  if ($('#demoOn')) $('#demoOn').onclick = async () => { await api('POST', '/api/demo'); await refresh(); location.hash = 'oversigt'; };
  if ($('#demoOff')) $('#demoOff').onclick = async () => { await api('DELETE', '/api/demo'); await refresh(); render(); };
}

// ---------- start ----------

refresh().then(render).catch((e) => {
  $('#view').innerHTML = `<div class="card empty"><h3>Kunne ikke kontakte serveren</h3><p>${esc(e.message)}</p><p>Start den med <code>node server.js</code> i projektmappen.</p></div>`;
});
