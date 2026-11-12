/* 덕자부동산 · 다산 지금지구 부동산 대시보드 */
'use strict';

// ---------------- 유틸 ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PY = 3.305785;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ymOf = (d) => d.getFullYear() * 100 + d.getMonth() + 1;
const nf = new Intl.NumberFormat('ko-KR');

function won(v) { // 만원 → "8억 7,000"
  if (v == null || isNaN(v)) return '-';
  v = Math.round(v);
  if (v >= 10000) { const e = Math.floor(v / 10000), r = v % 10000; return `${e}억${r ? ' ' + nf.format(r) : ''}`; }
  return nf.format(v) + '만';
}
const wonShort = (v) => (v >= 10000 ? (v / 10000).toFixed(v >= 100000 ? 1 : 2).replace(/\.?0+$/, '') + '억' : nf.format(Math.round(v)) + '만');
const pyeong = (a) => Math.round(a / PY);
const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
function delta(cur, prev, unit = '%', digits = 1) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return '<span class="flat">비교 데이터 없음</span>';
  const p = unit === '%' ? pct(cur, prev) : cur - prev;
  if (p == null || !isFinite(p)) return '<span class="flat">-</span>';
  const cls = p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat';
  const arrow = p > 0.05 ? '▲' : p < -0.05 ? '▼' : '–';
  return `<span class="${cls}">${arrow} ${Math.abs(p).toFixed(digits)}${unit}</span>`;
}
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distTxt = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);
const walkTxt = (m) => `도보 ${Math.max(1, Math.round((m * 1.3) / 67))}분`; // 직선거리×1.3 보정, 분당 67m

// ---------------- 상태 ----------------
const S = {
  dong: 'all', district: 'all', mode: 'month', includeRental: false,
  tab: 'trade', sort: 'count',
  range: null, prev: null,
  apts: [], aptByName: new Map(), pois: [], dev: [], listings: [],
  deals: { trade: [], rent: [] }, loadedSpan: null,
  reb: {}, selected: null, selectedListing: null,
  charts: {}, map: null, layers: {},
};

const SORTS = {
  trade: [['count', '거래량순'], ['ppp', '평당가순'], ['max', '최고가순']],
  jeonse: [['count', '거래량순'], ['ppp', '평당 보증금순'], ['max', '최고 보증금순']],
  wolse: [['count', '거래량순'], ['rent', '최고 월세순'], ['max', '최고 보증금순']],
};

// ---------------- 기간 ----------------
function computeRange() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let from, to;
  if (S.mode === 'week') {
    to = $('#inWeekEnd').value ? parseD($('#inWeekEnd').value) : today;
    from = addDays(to, -6);
  } else if (S.mode === 'month') {
    const v = $('#inMonth').value || `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
    const [y, m] = v.split('-').map(Number);
    from = new Date(y, m - 1, 1); to = new Date(y, m, 0);
    if (to > today) to = today;
  } else {
    from = $('#inFrom').value ? parseD($('#inFrom').value) : addDays(today, -30);
    to = $('#inTo').value ? parseD($('#inTo').value) : today;
    if (from > to) [from, to] = [to, from];
  }
  let pFrom, pTo;
  if (S.mode === 'month') { pFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1); pTo = new Date(from.getFullYear(), from.getMonth(), 0); }
  else { const len = Math.round((to - from) / 864e5) + 1; pTo = addDays(from, -1); pFrom = addDays(pTo, -(len - 1)); }
  S.range = { from: ymd(from), to: ymd(to) };
  S.prev = { from: ymd(pFrom), to: ymd(pTo) };
  const label = { week: '주간', month: '월간', custom: '기간' }[S.mode];
  $('#periodText').textContent = `${label} ${S.range.from.replaceAll('-', '.')} ~ ${S.range.to.replaceAll('-', '.')}  (비교: ${S.prev.from.slice(2).replaceAll('-', '.')} ~ ${S.prev.to.slice(2).replaceAll('-', '.')})`;
}

// ---------------- 데이터 로딩 ----------------
async function getJSON(url, opt) {
  if (EMBED) return standalone(url, opt || {});
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

// ---------------- 단독 실행(index.html) 모드 ----------------
// 서버 없이 파일만 열어도 동작: 기본 데이터·부동산원 지수는 파일에 내장,
// 국토부 실거래는 브라우저에서 공공데이터포털을 직접 호출(최근 2개월 실시간 갱신, 실패 시 내장본 사용)
const EMBED = window.__EMBED__ || null;
const liveMonths = new Map();
const xtag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };
const xnum = (s) => Number(String(s || '').replace(/,/g, '').trim()) || 0;
function unpackDeals(kind, rows) {
  return rows.map((r) => kind === 'trade'
    ? { apt: r[0], jibun: r[1], area: r[2], floor: r[3], date: r[4], price: r[5] }
    : { apt: r[0], jibun: r[1], area: r[2], floor: r[3], date: r[4], deposit: r[5], rent: r[6] });
}
async function liveMonth(kind, ym) {
  const svc = kind === 'trade' ? 'RTMSDataSvcAptTrade' : 'RTMSDataSvcAptRent';
  const items = [];
  for (let page = 1; page < 10; page++) {
    const url = `https://apis.data.go.kr/1613000/${svc}/get${svc}?serviceKey=${EMBED.liveKey}&LAWD_CD=${EMBED.lawdCd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
    const r = await fetch(url);
    const xml = await r.text();
    const code = xtag(xml, 'resultCode');
    if (!r.ok || (code && code !== '000' && code !== '00')) throw new Error(`${ym} ${code || r.status}`);
    for (const it of xml.split('<item>').slice(1)) {
      if (xtag(it, 'umdNm') !== EMBED.umdNm) continue;
      const area = xnum(xtag(it, 'excluUseAr')), floor = xnum(xtag(it, 'floor'));
      const date = `${xtag(it, 'dealYear')}-${xtag(it, 'dealMonth').padStart(2, '0')}-${xtag(it, 'dealDay').padStart(2, '0')}`;
      const base = { apt: xtag(it, 'aptNm'), jibun: xtag(it, 'jibun'), area, floor, date };
      if (kind === 'trade') { if (xtag(it, 'cdealType')) continue; items.push({ ...base, price: xnum(xtag(it, 'dealAmount')) }); }
      else items.push({ ...base, deposit: xnum(xtag(it, 'deposit')), rent: xnum(xtag(it, 'monthlyRent')) });
    }
    if (page * 1000 >= xnum(xtag(xml, 'totalCount'))) break;
  }
  return items;
}
async function monthDeals(kind, ym) {
  const key = kind + ym;
  if (liveMonths.has(key)) return liveMonths.get(key);
  const snap = EMBED.deals?.[kind]?.[ym];
  const recent = Number(ym) >= Number(EMBED.builtYm) - 1 || (EMBED.builtYm % 100 === 1 && Number(ym) >= Number(EMBED.builtYm) - 89);
  let out;
  if (EMBED.liveKey && (!snap || recent)) {
    try { out = { items: await liveMonth(kind, ym), live: true }; }
    catch (e) { out = snap ? { items: unpackDeals(kind, snap), err: null } : { items: [], err: `${ym}: ${e.message}` }; }
  } else out = snap ? { items: unpackDeals(kind, snap) } : { items: [], err: `${ym}: 내장 자료 없음` };
  liveMonths.set(key, out);
  return out;
}
async function standalone(url, opt) {
  const u = new URL(url, 'http://local');
  const p = u.pathname;
  if (p === '/data/apartments.json') return EMBED.apartments;
  if (p === '/data/pois.json') return EMBED.pois;
  if (p === '/data/development.json') return EMBED.development;
  if (p === '/api/listings') {
    if ((opt.method || 'GET') === 'PUT') { localStorage.setItem('dj-listings', opt.body); return { ok: true }; }
    try { const s = localStorage.getItem('dj-listings'); if (s) return JSON.parse(s); } catch {}
    return EMBED.listings;
  }
  if (p === '/api/reb') {
    const t = u.searchParams.get('table');
    const series = {};
    for (const c of (u.searchParams.get('cls') || '').split(',')) series[c] = EMBED.reb?.[t]?.[c] || [];
    return { table: t, series };
  }
  if (p === '/api/deals') {
    const kind = u.searchParams.get('kind');
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
    const months = [];
    for (let y = Math.floor(from / 100), m = from % 100; y * 100 + m <= to && months.length < 36; m === 12 ? (y++, (m = 1)) : m++) months.push(`${y}${pad(m)}`);
    const items = [], errors = [];
    for (let i = 0; i < months.length; i += 3) {
      const rs = await Promise.all(months.slice(i, i + 3).map((ym) => monthDeals(kind, ym)));
      rs.forEach((r) => { items.push(...r.items); if (r.err) errors.push(r.err); });
    }
    return { kind, months, count: items.length, items, errors };
  }
  throw new Error('unknown ' + p);
}
function status(msg, err) {
  const el = $('#status');
  if (!msg) { el.hidden = true; return; }
  el.hidden = false; el.textContent = msg; el.classList.toggle('err', !!err);
}

async function loadStatic() {
  const [apts, pois, dev, listings] = await Promise.all([
    getJSON('/data/apartments.json'), getJSON('/data/pois.json'), getJSON('/data/development.json'),
    getJSON('/api/listings').catch(() => JSON.parse(localStorage.getItem('dj-listings') || '[]')),
  ]);
  S.apts = apts; S.pois = pois; S.dev = dev; S.listings = listings;
  for (const a of apts) S.aptByName.set(a.name, a);
}

async function loadDeals() {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth() - 12, 1); // 최근 13개월 기본 확보
  const from = Math.min(ymOf(parseD(S.prev.from)), ymOf(base));
  const to = Math.max(ymOf(parseD(S.range.to)), ymOf(today));
  const span = `${from}-${to}`;
  if (S.loadedSpan === span) return;
  status('국토교통부 실거래 자료를 불러오는 중입니다… (처음 실행 시 30초 정도 걸릴 수 있습니다)');
  const [t, r] = await Promise.all([
    getJSON(`/api/deals?kind=trade&from=${from}&to=${to}`),
    getJSON(`/api/deals?kind=rent&from=${from}&to=${to}`),
  ]);
  const enrich = (d) => { const a = S.aptByName.get(d.apt); d.a = a || null; d.ym = d.date.slice(0, 7); return d; };
  S.deals.trade = t.items.map(enrich);
  S.deals.rent = r.items.map(enrich);
  S.loadedSpan = span;
  const errs = [...t.errors, ...r.errors];
  status(errs.length ? '일부 월 자료를 받지 못했습니다: ' + errs.slice(0, 3).join(' / ') : '', errs.length > 0);
}

async function loadReb() {
  const y = new Date().getFullYear();
  const q = (table, cycle, cls, start, end) => getJSON(`/api/reb?table=${table}&cycle=${cycle}&cls=${cls}&start=${start}&end=${end}`).then((j) => j.series).catch(() => ({}));
  const [sale, jeonse, demand, unsold, vol] = await Promise.all([
    q('weeklySale', 'WK', '50107,50016,50002', `${y - 2}01`, `${y}53`),
    q('weeklyJeonse', 'WK', '50107,50016,50002', `${y - 2}01`, `${y}53`),
    q('weeklyDemand', 'WK', '50020,50016', `${y - 2}01`, `${y}53`),
    q('unsold', 'MM', '50250', `${y - 2}01`, `${y}12`),
    q('aptTrade', 'MM', '510100', `${y - 2}01`, `${y}12`),
  ]);
  const clean = (arr) => (Array.isArray(arr) ? arr.filter((r) => r.v != null).sort((a, b) => (a.t > b.t ? 1 : -1)) : []);
  S.reb = {
    sale: { nyj: clean(sale['50107']), gg: clean(sale['50016']), sdk: clean(sale['50002']) },
    jeonse: { nyj: clean(jeonse['50107']), gg: clean(jeonse['50016']), sdk: clean(jeonse['50002']) },
    demand: { east1: clean(demand['50020']), gg: clean(demand['50016']) },
    unsold: clean(unsold['50250']),
    vol: clean(vol['510100']).filter((r) => /동\(호\)수|호수/.test(r.item) || r.unit === '호수'),
  };
}

// ---------------- 필터링 & 집계 ----------------
function aptPass(a) {
  if (S.dong !== 'all' && (!a || a.hdong !== S.dong)) return false;
  if (S.district !== 'all' && (!a || a.district !== S.district)) return false;
  if (!S.includeRental && a?.rental) return false;
  return true;
}
function dealsIn(kind, r) {
  const src = kind === 'trade' ? S.deals.trade : S.deals.rent;
  return src.filter((d) => d.date >= r.from && d.date <= r.to && aptPass(d.a) &&
    (kind === 'trade' || (kind === 'jeonse' ? d.rent === 0 : d.rent > 0)));
}
const val = (kind, d) => (kind === 'trade' ? d.price : d.deposit);
function summary(kind, r) {
  const ds = dealsIn(kind, r);
  const n = ds.length;
  const ppp = n ? ds.reduce((s, d) => s + val(kind, d) / (d.area / PY), 0) / n : null;
  const avg = n ? ds.reduce((s, d) => s + val(kind, d), 0) / n : null;
  const rent = kind === 'wolse' && n ? ds.reduce((s, d) => s + d.rent, 0) / n : null;
  return { n, ppp, avg, rent };
}
function rankList(kind) {
  const ds = dealsIn(kind, S.range);
  const g = new Map();
  for (const d of ds) {
    const k = d.apt;
    let o = g.get(k);
    if (!o) { o = { name: d.apt, a: d.a, list: [] }; g.set(k, o); }
    o.list.push(d);
  }
  const rows = [...g.values()].map((o) => {
    o.list.sort((x, y) => (x.date < y.date ? 1 : -1));
    o.n = o.list.length;
    o.max = Math.max(...o.list.map((d) => val(kind, d)));
    o.maxRent = Math.max(...o.list.map((d) => d.rent || 0));
    o.ppp = o.list.reduce((s, d) => s + val(kind, d) / (d.area / PY), 0) / o.n;
    o.latest = o.list[0];
    return o;
  });
  const key = S.sort;
  rows.sort((x, y) => {
    const v = key === 'count' ? y.n - x.n || y.ppp - x.ppp : key === 'ppp' ? y.ppp - x.ppp : key === 'rent' ? y.maxRent - x.maxRent : y.max - x.max;
    return v;
  });
  return rows.slice(0, 10);
}

// ---------------- KPI ----------------
function lastChange(series) {
  if (!series || series.length < 2) return null;
  const a = series[series.length - 1], b = series[series.length - 2];
  return { v: a.v, ch: (a.v / b.v - 1) * 100, label: a.label };
}
function renderKpis() {
  const cur = { t: summary('trade', S.range), j: summary('jeonse', S.range), w: summary('wolse', S.range) };
  const prv = { t: summary('trade', S.prev), j: summary('jeonse', S.prev), w: summary('wolse', S.prev) };
  const ratio = cur.t.ppp && cur.j.ppp ? (cur.j.ppp / cur.t.ppp) * 100 : null;
  const ratioP = prv.t.ppp && prv.j.ppp ? (prv.j.ppp / prv.t.ppp) * 100 : null;
  const s = lastChange(S.reb.sale?.nyj), j = lastChange(S.reb.jeonse?.nyj);
  const un = S.reb.unsold || [];
  const unL = un[un.length - 1], unP = un[un.length - 2];
  const dm = S.reb.demand?.east1 || [];
  const dmL = dm[dm.length - 1], dmP = dm[dm.length - 2];
  const chg = (c) => (c == null ? '-' : `<span class="${c.ch > 0.005 ? 'up' : c.ch < -0.005 ? 'down' : 'flat'}">${c.ch > 0 ? '▲' : c.ch < 0 ? '▼' : '–'} ${Math.abs(c.ch).toFixed(2)}%</span>`);
  const tiles = [
    ['매매 거래량', `${nf.format(cur.t.n)}<small>건</small>`, `직전 ${nf.format(prv.t.n)}건 ${delta(cur.t.n, prv.t.n)}`],
    ['매매 평균 평당가', cur.t.ppp ? `${nf.format(Math.round(cur.t.ppp))}<small>만/3.3㎡</small>` : '-', delta(cur.t.ppp, prv.t.ppp)],
    ['전세 거래량', `${nf.format(cur.j.n)}<small>건</small>`, `직전 ${nf.format(prv.j.n)}건 ${delta(cur.j.n, prv.j.n)}`],
    ['전세 평균 평당가', cur.j.ppp ? `${nf.format(Math.round(cur.j.ppp))}<small>만/3.3㎡</small>` : '-', delta(cur.j.ppp, prv.j.ppp)],
    ['월세 거래량 · 평균월세', `${nf.format(cur.w.n)}<small>건</small>`, cur.w.rent ? `평균 ${Math.round(cur.w.rent)}만 · 직전 ${nf.format(prv.w.n)}건` : `직전 ${nf.format(prv.w.n)}건`],
    ['전세가율 (평당 기준)', ratio ? `${ratio.toFixed(1)}<small>%</small>` : '-', ratio && ratioP ? delta(ratio, ratioP, '%p') : '<span class="flat">-</span>'],
    ['남양주 주간 매매지수', s ? `${s.v.toFixed(2)}` : '-', s ? `${chg(s)} · ${s.label} · 전세 ${chg(j)}` : '부동산원 자료 없음', 'reb'],
    ['남양주 미분양', unL ? `${nf.format(unL.v)}<small>호</small>` : '-', unL ? `${unL.label} ${unP ? delta(unL.v, unP.v, '호', 0) : ''}` : '부동산원 자료 없음', 'reb'],
  ];
  $('#kpis').innerHTML = tiles.map(([k, v, d, c]) => `<div class="kpi ${c || ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  if (dmL) $('#kpis').children[6].title = `매매수급(동부1권) ${dmL.v.toFixed(1)} (${dmL.label})${dmP ? ', 직전 ' + dmP.v.toFixed(1) : ''}`;
}

// ---------------- Top10 ----------------
function districtBadge(a) {
  if (!a) return '';
  const cls = a.district === '지금지구' ? 'jg' : a.district === '진건지구' ? 'jk' : '';
  const t = a.district.startsWith('도농') ? '도농·지금' : a.district;
  return `<span class="badge ${cls}">${esc(t)}</span><span class="badge">${esc(a.hdong)}</span>`;
}
function renderSortOptions() {
  $('#selSort').innerHTML = SORTS[S.tab].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  if (!SORTS[S.tab].some(([v]) => v === S.sort)) S.sort = 'count';
  $('#selSort').value = S.sort;
}
let TOP = [];
function renderTop10() {
  const kind = S.tab;
  TOP = rankList(kind);
  const label = { trade: '매매', jeonse: '전세', wolse: '월세' }[kind];
  const dongTxt = S.dong === 'all' ? '다산동 전체' : S.dong;
  $('#top10Hint').textContent = `${dongTxt}${S.district !== 'all' ? ' · ' + S.district : ''} · ${label} 실거래 ${S.range.from} ~ ${S.range.to} · ${SORTS[kind].find(([v]) => v === S.sort)[1]} · 행을 클릭하면 지도와 입지분석이 표시됩니다${(new Date() - parseD(S.range.to)) / 864e5 < 30 ? ' · ※ 실거래는 계약 후 30일 내 신고되어 최근 거래는 추가될 수 있습니다' : ''}`;
  const t = $('#rankTable');
  if (!TOP.length) {
    t.innerHTML = `<tbody><tr><td class="empty">선택한 기간에 ${label} 실거래 신고가 없습니다.<br>기간을 늘리거나(월간·직접지정) 다른 동을 선택해 보세요.</td></tr></tbody>`;
    renderMap();
    return;
  }
  const head = kind === 'trade'
    ? '<th>#</th><th>단지</th><th class="r">거래</th><th class="r">최근 거래</th><th class="r">평균 평당가</th><th class="r">최고가</th>'
    : kind === 'jeonse'
      ? '<th>#</th><th>단지</th><th class="r">거래</th><th class="r">최근 전세</th><th class="r">평당 보증금</th><th class="r">최고 보증금</th>'
      : '<th>#</th><th>단지</th><th class="r">거래</th><th class="r">최근 월세</th><th class="r">최고 월세</th><th class="r">최고 보증금</th>';
  const rows = TOP.map((o, i) => {
    const L = o.latest;
    const recent = kind === 'wolse' ? `${won(L.deposit)} / ${L.rent}만` : won(val(kind, L));
    const c5 = kind === 'wolse' ? `${o.maxRent}만` : `${nf.format(Math.round(o.ppp))}만`;
    const c6 = won(o.max);
    return `<tr data-i="${i}" class="${S.selected === o.name ? 'sel' : ''}">
      <td><span class="rk">${i + 1}</span></td>
      <td><div class="aname">${esc(o.name)}${districtBadge(o.a)}</div><div class="ameta">${o.a ? o.a.built + '년 준공 · ' : ''}${esc(o.a?.road || '')}</div></td>
      <td class="r">${o.n}건</td>
      <td class="r"><div class="price">${recent}</div><div class="ameta">${Math.round(L.area)}㎡(${pyeong(L.area)}평) · ${L.floor}층 · ${L.date.slice(5).replace('-', '.')}</div></td>
      <td class="r">${c5}</td>
      <td class="r">${c6}</td></tr>`;
  }).join('');
  t.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody>`;
  $$('tbody tr', t).forEach((tr) => tr.addEventListener('click', () => selectApt(TOP[+tr.dataset.i].name, { from: 'top' })));
  renderMap();
}

// ---------------- 지도 ----------------
function initMap() {
  const map = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([37.614, 127.158], 14);
  // 국토교통부 브이월드 배경지도 (한글 지명·아파트명 표기, 키 없이 파일로 열어도 동작)
  // ※ OSM 공식 타일(tile.openstreetmap.org)은 파일로 열면 'Access blocked' 이미지가 나와 사용하지 않음
  const VW = 'https://xdworld.vworld.kr/2d';
  const vwAttr = '&copy; 국토교통부 브이월드';
  const base = L.tileLayer(`${VW}/Base/service/{z}/{x}/{y}.png`, { maxZoom: 19, minZoom: 6, attribution: vwAttr }).addTo(map);
  const sat = L.layerGroup([
    L.tileLayer(`${VW}/Satellite/service/{z}/{x}/{y}.jpeg`, { maxZoom: 19, minZoom: 6, attribution: vwAttr }),
    L.tileLayer(`${VW}/Hybrid/service/{z}/{x}/{y}.png`, { maxZoom: 19, minZoom: 6 }),
  ]);
  L.control.layers({ '일반지도': base, '위성지도': sat }, null, { position: 'topright', collapsed: false }).addTo(map);
  // 브이월드 접속 실패가 이어지면 OSM 독일 서버로 자동 전환
  let fails = 0;
  base.on('tileerror', () => {
    if (++fails !== 4 || !map.hasLayer(base)) return;
    map.removeLayer(base);
    L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  });
  S.map = map;
  S.layers.others = L.layerGroup().addTo(map);
  S.layers.top = L.layerGroup().addTo(map);
  S.layers.star = L.layerGroup().addTo(map);
  S.layers.poi = L.layerGroup().addTo(map);
}
function recentDealsFor(name, n = 8) {
  const t = S.deals.trade.filter((d) => d.apt === name).map((d) => ({ ...d, ty: '매매', amt: won(d.price) }));
  const r = S.deals.rent.filter((d) => d.apt === name).map((d) => ({ ...d, ty: d.rent ? '월세' : '전세', amt: d.rent ? `${won(d.deposit)}/${d.rent}만` : won(d.deposit) }));
  return { trade: t.sort((a, b) => (a.date < b.date ? 1 : -1)), rent: r.sort((a, b) => (a.date < b.date ? 1 : -1)), all: [...t, ...r].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n) };
}
function popupHtml(a) {
  const rd = recentDealsFor(a.name, 6);
  const rows = rd.all.map((d) => `<tr><td class="ty">${d.ty}</td><td>${d.amt}</td><td>${Math.round(d.area)}㎡</td><td>${d.floor}층</td><td>${d.date.slice(2).replaceAll('-', '.')}</td></tr>`).join('');
  return `<div class="pop"><h4>${esc(a.name)}</h4><div style="color:#4b5563;margin-bottom:4px">${esc(a.road)} · ${a.built}년</div>${rows ? `<table>${rows}</table>` : '<div>최근 실거래 없음</div>'}</div>`;
}
function renderMap() {
  if (!S.map) return;
  const { others, top, star } = S.layers;
  others.clearLayers(); top.clearLayers(); star.clearLayers();
  const topNames = new Set(TOP.map((o) => o.name));
  for (const a of S.apts) {
    if (!a.lat || topNames.has(a.name) || !aptPass(a)) continue;
    L.circleMarker([a.lat, a.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#b8c0cc', fillOpacity: 1 })
      .bindTooltip(a.name, { direction: 'top' }).on('click', () => selectApt(a.name, { from: 'map' })).addTo(others);
  }
  const kind = S.tab;
  TOP.forEach((o, i) => {
    const a = o.a; if (!a?.lat) return;
    const L0 = o.latest;
    const price = kind === 'wolse' ? `${wonShort(L0.deposit)}/${L0.rent}` : wonShort(val(kind, L0));
    const html = `<div class="mk ${S.selected === o.name ? 'sel' : ''}"><span class="n">${i + 1}</span><span class="t">${esc(o.name.replace(/^다산\s?/, ''))} <b>${price}</b></span></div>`;
    L.marker([a.lat, a.lng], { icon: L.divIcon({ html, className: '', iconSize: [0, 0] }), zIndexOffset: S.selected === o.name ? 1000 : 500 - i })
      .bindPopup(popupHtml(a), { maxWidth: 320 }).on('click', () => selectApt(o.name, { from: 'map', keepPopup: true })).addTo(top);
  });
  for (const l of S.listings) {
    const a = S.apts.find((x) => x.id === l.aptId); if (!a?.lat) continue;
    const html = `<div class="mk star ${S.selectedListing === l.id ? 'sel' : ''}"><span class="n">★</span><span class="t">${esc(l.type)} <b>${listingPrice(l, true)}</b></span></div>`;
    L.marker([a.lat + 0.0006, a.lng], { icon: L.divIcon({ html, className: '', iconSize: [0, 0] }), zIndexOffset: 1200 })
      .on('click', () => selectListing(l.id)).addTo(star);
  }
  if (!S.selected) fitTop();
}
function fitTop() {
  const pts = TOP.map((o) => o.a).filter((a) => a?.lat).map((a) => [a.lat, a.lng]);
  if (pts.length) S.map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  $('#mapTitle').textContent = `${{ trade: '매매', jeonse: '전세', wolse: '월세' }[S.tab]} Top 10 단지 위치`;
}

// ---------------- 단지 선택 → 상세 + 입지분석 ----------------
function nearest(a, cats, n, maxM = Infinity) {
  const cs = Array.isArray(cats) ? cats : [cats];
  return S.pois.filter((p) => cs.includes(p.cat)).map((p) => ({ ...p, d: haversine(a, p) })).filter((p) => p.d <= maxM).sort((x, y) => x.d - y.d).slice(0, n);
}
function within(a, cat, m) { return S.pois.filter((p) => p.cat === cat && haversine(a, p) <= m).length; }

function selectApt(name, opt = {}) {
  const a = S.aptByName.get(name);
  S.selected = name;
  if (opt.from !== 'listing') S.selectedListing = null;
  $$('#rankTable tbody tr').forEach((tr) => tr.classList.toggle('sel', TOP[+tr.dataset.i]?.name === name));
  $$('.lst').forEach((el) => el.classList.toggle('sel', el.dataset.id === S.selectedListing));
  renderMap();
  if (!a || !a.lat) { $('#detailCard').hidden = false; $('#detailCard').innerHTML = `<div class="detail"><h2>${esc(name)}</h2><p class="addr">위치 정보가 없는 단지입니다.</p></div>`; return; }
  S.map.setView([a.lat, a.lng], 16, { animate: true });
  $('#mapTitle').textContent = `${a.name} 위치 · 주변시설`;
  if (opt.from !== 'map' || !opt.keepPopup) {
    setTimeout(() => {
      let found = false;
      S.layers.top.eachLayer((m) => { const ll = m.getLatLng(); if (Math.abs(ll.lat - a.lat) < 1e-6 && Math.abs(ll.lng - a.lng) < 1e-6) { m.openPopup(); found = true; } });
      if (!found) L.popup({ maxWidth: 320 }).setLatLng([a.lat, a.lng]).setContent(popupHtml(a)).openOn(S.map);
    }, 250);
  }
  renderPoiLayer(a);
  renderDetail(a);
  renderAnalysis(a);
}

function renderPoiLayer(a) {
  const g = S.layers.poi; g.clearLayers();
  const add = (list, color, label) => list.forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
    .bindTooltip(`${label} ${p.name} · ${distTxt(p.d)}`, { direction: 'top' }).addTo(g));
  add(nearest(a, 'subway', 3), '#7b4fd6', '🚇');
  add(nearest(a, ['elem', 'mid', 'high'], 6, 1500), '#11805a', '🏫');
  add(nearest(a, ['mart', 'dept'], 4, 3000), '#eb6834', '🛒');
  L.circle([a.lat, a.lng], { radius: 500, color: '#2a78d6', weight: 1, fillOpacity: 0.04, dashArray: '4 4' }).addTo(g);
}

function renderDetail(a) {
  const rd = recentDealsFor(a.name, 10);
  const lastT = rd.trade[0], lastJ = rd.rent.find((d) => d.ty === '전세'), lastW = rd.rent.find((d) => d.ty === '월세');
  // 면적대별 최근 매매가
  const byArea = new Map();
  for (const d of rd.trade) { const k = Math.round(d.area); if (!byArea.has(k)) byArea.set(k, d); }
  const areaRows = [...byArea.entries()].sort((x, y) => x[0] - y[0]).slice(0, 4).map(([k, d]) => `${k}㎡ ${won(d.price)}`).join(' · ');
  const yrT = rd.trade.filter((d) => d.date >= ymd(addDays(new Date(), -365)));
  const jr = (() => { // 전세가율 (단지, 최근 1년, 평당 기준)
    const j = rd.rent.filter((d) => d.ty === '전세' && d.date >= ymd(addDays(new Date(), -365)));
    if (!yrT.length || !j.length) return null;
    const p = (arr, f) => arr.reduce((s, d) => s + f(d) / (d.area / PY), 0) / arr.length;
    return (p(j, (d) => d.deposit) / p(yrT, (d) => d.price)) * 100;
  })();
  $('#detailCard').hidden = false;
  $('#detailCard').innerHTML = `<div class="detail">
    <div style="display:flex;gap:8px;align-items:center"><h2 style="margin-right:auto">${esc(a.name)} ${districtBadge(a)}</h2><button class="btn small" onclick="document.getElementById('analysisCard').scrollIntoView({behavior:'smooth'})">입지분석 보기 ↓</button></div>
    <div class="addr">남양주시 ${esc(a.road)} (다산동 ${esc(a.jibun)}) · ${a.built}년 준공${a.rental ? ' · 공공임대' : ''}</div>
    <div class="dl-grid">
      <div><div class="k">최근 매매</div><div class="v">${lastT ? won(lastT.price) : '-'}</div><div class="ameta">${lastT ? `${Math.round(lastT.area)}㎡ · ${lastT.floor}층 · ${lastT.date.slice(2).replaceAll('-', '.')}` : ''}</div></div>
      <div><div class="k">최근 전세</div><div class="v">${lastJ ? won(lastJ.deposit) : '-'}</div><div class="ameta">${lastJ ? `${Math.round(lastJ.area)}㎡ · ${lastJ.floor}층 · ${lastJ.date.slice(2).replaceAll('-', '.')}` : ''}</div></div>
      <div><div class="k">최근 월세</div><div class="v">${lastW ? `${wonShort(lastW.deposit)}/${lastW.rent}만` : '-'}</div><div class="ameta">${lastW ? `${Math.round(lastW.area)}㎡ · ${lastW.date.slice(2).replaceAll('-', '.')}` : ''}</div></div>
      <div><div class="k">최근 1년 매매</div><div class="v">${yrT.length}건</div></div>
      <div><div class="k">전세가율(1년)</div><div class="v">${jr ? jr.toFixed(1) + '%' : '-'}</div></div>
      <div><div class="k">1년 최고 매매가</div><div class="v">${yrT.length ? won(Math.max(...yrT.map((d) => d.price))) : '-'}</div></div>
    </div>
    ${areaRows ? `<div class="ameta" style="margin-bottom:8px">면적별 최근 매매 · ${areaRows}</div>` : ''}
    <table class="deals"><thead><tr><th>구분</th><th class="r">금액</th><th class="r">전용</th><th class="r">층</th><th class="r">계약일</th></tr></thead>
    <tbody>${rd.all.map((d) => `<tr><td>${d.ty}</td><td class="r"><b>${d.amt}</b></td><td class="r">${Math.round(d.area)}㎡(${pyeong(d.area)}평)</td><td class="r">${d.floor}</td><td class="r">${d.date.replaceAll('-', '.')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">최근 13개월 실거래 없음</td></tr>'}</tbody></table>
  </div>`;
}

function liList(items, fmt) {
  return items.length ? `<ul>${items.map(fmt).join('')}</ul>` : '<ul><li><span>정보 없음</span></li></ul>';
}
function renderAnalysis(a) {
  const sub = nearest(a, 'subway', 3);
  const ktx = nearest(a, 'ktx', 2);
  const bus = nearest(a, 'bus', 3);
  const busN = within(a, 'bus', 400);
  const routes = [...new Set(nearest(a, 'bus', 8, 600).flatMap((p) => p.routes || []))].slice(0, 10);
  const el = nearest(a, 'elem', 3), mi = nearest(a, 'mid', 2), hi = nearest(a, 'high', 2);
  const kin = within(a, 'kinder', 1000);
  const mart = nearest(a, 'mart', 3), dept = nearest(a, 'dept', 2);
  const cafeN = within(a, 'cafe', 700), cafe = nearest(a, 'cafe', 2);
  const gov = nearest(a, ['gov', 'library'], 4), hosp = nearest(a, 'hospital', 2), park = nearest(a, 'park', 2);
  const row = (p, extra = '') => `<li><span>${esc(p.name)}${extra}</span><span class="ds">${distTxt(p.d)} · ${walkTxt(p.d)}</span></li>`;
  const rowKm = (p, extra = '') => `<li><span>${esc(p.name)}${extra}</span><span class="ds">${distTxt(p.d)}</span></li>`;
  const card = $('#analysisCard');
  card.hidden = false;
  card.innerHTML = `
    <div class="ana-head"><h2>📍 ${esc(a.name)} 입지분석</h2><p>${esc(a.district)} · ${esc(a.hdong)} · 거리는 단지 중심 기준 직선거리(도보시간은 1.3배 보정 추정)</p></div>
    <div class="ana-grid">
      <div class="ana tr"><h3><span class="ic">🚇</span>교통</h3>
        <h4>지하철 · 전철</h4>${liList(sub, (p) => row(p, `<span class="ln">${esc(p.lines.join('·'))}</span>`))}
        <h4>KTX</h4>${liList(ktx, (p) => rowKm(p, `<span class="ln">${esc(p.lines[0])}</span>`))}
        <h4>버스 (반경 400m 정류장 ${busN}곳)</h4>${liList(bus, (p) => row(p))}
        ${routes.length ? `<div class="note">주변 노선: ${routes.map(esc).join(', ')}</div>` : ''}
        <h4>도로</h4><ul><li><span>강변북로 · 수석호평도시고속도로 · 북부간선도로(구리)</span></li></ul>
      </div>
      <div class="ana sc"><h3><span class="ic">🏫</span>학군</h3>
        <h4>초등학교</h4>${liList(el, (p) => row(p))}
        <h4>중학교</h4>${liList(mi, (p) => row(p))}
        <h4>고등학교</h4>${liList(hi, (p) => row(p))}
        <div class="note">반경 1km 유치원 ${kin}곳 · 실제 배정학교는 학구도(학교알리미) 확인</div>
      </div>
      <div class="ana sh"><h3><span class="ic">🛍</span>상권 · 생활</h3>
        <h4>대형마트 · 슈퍼</h4>${liList(mart, (p) => row(p))}
        <h4>백화점 · 아울렛</h4>${liList(dept, (p) => rowKm(p))}
        <h4>커피숍 (반경 700m ${cafeN}곳 등록)</h4>${liList(cafe, (p) => row(p))}
        <h4>관공서 · 도서관</h4>${liList(gov, (p) => row(p))}
        <h4>병원 · 공원</h4>${liList([...hosp, ...park], (p) => rowKm(p))}
      </div>
      <div class="ana dv"><h3><span class="ic">🏗</span>주변 개발계획</h3>
        ${S.dev.map((d) => `<div class="dev"><div class="dt">${esc(d.title)}<span class="st ${esc(d.status)}">${esc(d.status)}</span></div><div class="wh">${esc(d.when)}</div><div class="ds2">${esc(d.desc)}</div>${d.source ? `<a href="${esc(d.source)}" target="_blank" rel="noopener">출처</a>` : ''}</div>`).join('')}
      </div>
    </div>`;
}

// ---------------- 추천매물 ----------------
function listingPrice(l, short) {
  const f = short ? wonShort : won;
  return l.type === '월세' ? `${f(l.price)}/${l.rent}만` : f(l.price);
}
function listingCompare(l) {
  const a = S.apts.find((x) => x.id === l.aptId); if (!a) return '';
  const rd = recentDealsFor(a.name, 50);
  const pool = l.type === '매매' ? rd.trade : rd.rent.filter((d) => d.ty === l.type);
  const near = pool.filter((d) => Math.abs(d.area - l.area) < 3);
  if (!near.length) return '';
  const d = near[0];
  const v = l.type === '매매' ? d.price : d.deposit;
  const diff = l.price - v;
  return `동일평형 최근 실거래 ${l.type === '월세' ? `${won(d.deposit)}/${d.rent}만` : won(v)} (${d.date.slice(2).replaceAll('-', '.')}, ${d.floor}층)${l.type !== '월세' && diff ? ` · 대비 ${diff > 0 ? '+' : '-'}${won(Math.abs(diff))}` : ''}`;
}
function renderListings() {
  $('#listings').innerHTML = S.listings.map((l) => {
    const a = S.apts.find((x) => x.id === l.aptId);
    const cmp = listingCompare(l);
    return `<div class="lst ${S.selectedListing === l.id ? 'sel' : ''}" data-id="${esc(l.id)}">
      <button class="edit" data-edit="${esc(l.id)}" title="수정">✎ 수정</button>
      <span class="ty ${esc(l.type)}">${esc(l.type)}</span>
      <div class="lp">${listingPrice(l)}</div>
      <div class="la">${esc(a?.name || '단지 미지정')}</div>
      <div class="lm">전용 ${l.area}㎡(${pyeong(l.area)}평) · ${esc(l.floor || '')}${a ? ' · ' + esc(a.district) : ''}</div>
      <div class="lt"><b>${esc(l.title)}</b>${l.desc ? ' — ' + esc(l.desc) : ''}</div>
      ${l.tags?.length ? `<div class="tags">${l.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      ${cmp ? `<div class="cmp">${cmp}</div>` : ''}
    </div>`;
  }).join('') || '<div class="empty">등록된 추천매물이 없습니다. ＋ 매물 추가를 눌러 등록하세요.</div>';
  $$('.lst').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit]')) { openListingDialog(e.target.closest('[data-edit]').dataset.edit); return; }
    selectListing(el.dataset.id);
  }));
}
function selectListing(id) {
  const l = S.listings.find((x) => x.id === id); if (!l) return;
  const a = S.apts.find((x) => x.id === l.aptId); if (!a) return;
  S.selectedListing = id;
  selectApt(a.name, { from: 'listing' });
  $('#analysisCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function saveListings() {
  try { localStorage.setItem('dj-listings', JSON.stringify(S.listings)); } catch {}
  try { await getJSON('/api/listings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.listings) }); }
  catch { status('서버 저장 실패 — 이 브라우저에만 임시 저장되었습니다.', true); }
}
function openListingDialog(id) {
  const dlg = $('#dlgListing'), f = $('#formListing');
  const opts = S.apts.filter((a) => !a.rental || true).slice().sort((x, y) => x.name.localeCompare(y.name, 'ko'))
    .map((a) => `<option value="${a.id}">${esc(a.name)} (${esc(a.district.startsWith('도농') ? '도농·지금' : a.district)})</option>`).join('');
  $('#fApt').innerHTML = opts;
  const l = id ? S.listings.find((x) => x.id === id) : null;
  f.reset();
  $('#dlgTitle').textContent = l ? '추천매물 수정' : '추천매물 추가';
  $('#btnDelListing').hidden = !l;
  if (l) {
    f.aptId.value = l.aptId; f.type.value = l.type; f.price.value = l.price; f.rent.value = l.rent || '';
    f.area.value = l.area; f.floor.value = l.floor || ''; f.title.value = l.title; f.desc.value = l.desc || ''; f.tags.value = (l.tags || []).join(', ');
  }
  dlg.dataset.id = id || '';
  toggleRentField();
  dlg.showModal();
}
function toggleRentField() {
  const t = $('#fType').value;
  $('.f-rent').style.display = t === '월세' ? '' : 'none';
  $('.f-price').firstChild.textContent = (t === '매매' ? '매매가' : '보증금') + ' (만원) ';
}
function bindListingDialog() {
  const dlg = $('#dlgListing'), f = $('#formListing');
  $('#fType').addEventListener('change', toggleRentField);
  $('#btnCancel').onclick = () => dlg.close();
  $('#btnDelListing').onclick = async () => {
    if (!confirm('이 매물을 삭제할까요?')) return;
    S.listings = S.listings.filter((x) => x.id !== dlg.dataset.id);
    await saveListings(); dlg.close(); renderListings(); renderMap();
  };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = {
      id: dlg.dataset.id || 'L' + Date.now().toString(36),
      aptId: f.aptId.value, type: f.type.value, price: +f.price.value, rent: f.type.value === '월세' ? +f.rent.value || 0 : 0,
      area: +f.area.value, floor: f.floor.value.trim(), title: f.title.value.trim(), desc: f.desc.value.trim(),
      tags: f.tags.value.split(',').map((s) => s.trim()).filter(Boolean), updated: ymd(new Date()),
    };
    const i = S.listings.findIndex((x) => x.id === o.id);
    if (i >= 0) S.listings[i] = o; else S.listings.unshift(o);
    await saveListings(); dlg.close(); renderListings(); renderMap(); selectListing(o.id);
  });
}

// ---------------- 차트 ----------------
const C = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', grid: '#eef1f5', text: '#4b5563' };
Chart.defaults.font.family = "Pretendard, 'Malgun Gothic', sans-serif";
Chart.defaults.font.size = 11.5;
Chart.defaults.color = C.text;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.plugins.tooltip.mode = 'index';
Chart.defaults.plugins.tooltip.intersect = false;
Chart.defaults.maintainAspectRatio = false;

function mkChart(id, cfg) {
  if (S.charts[id]) S.charts[id].destroy();
  const base = {
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { grid: { color: C.grid }, border: { display: false } } },
      plugins: { legend: { position: 'top', align: 'end' } },
    },
  };
  const c = { ...cfg, options: deepMerge(base.options, cfg.options || {}) };
  S.charts[id] = new Chart(document.getElementById(id), c);
}
function deepMerge(a, b) { const o = { ...a }; for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? deepMerge(a[k] || {}, b[k]) : b[k]; return o; }
const line = (label, data, color, extra = {}) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, ...extra });

function seriesWindow(arr) {
  // 주간: 기준일까지 최근 26주 / 월간: 최근 24개월(월말 주) / 직접: 기간 내 (최소 12주)
  if (!arr?.length) return [];
  const to = S.range.to, from = S.range.from;
  const upto = arr.filter((r) => r.label <= to);
  if (S.mode === 'week') return upto.slice(-26);
  if (S.mode === 'month') {
    const m = new Map(); for (const r of upto) m.set(r.label.slice(0, 7), r);
    return [...m.values()].slice(-24).map((r) => ({ ...r, label: r.label.slice(0, 7) }));
  }
  const inR = upto.filter((r) => r.label >= from);
  return inR.length >= 12 ? inR : upto.slice(-12);
}
function indexChart(id, src, subId, title) {
  const n = seriesWindow(src.nyj), g = seriesWindow(src.gg), s = seriesWindow(src.sdk);
  const byLabel = (arr) => new Map(arr.map((r) => [r.label, r.v]));
  const gm = byLabel(g), sm = byLabel(s);
  const labels = n.map((r) => r.label);
  const fmtL = labels.map((l) => (l.length > 7 ? l.slice(5).replace('-', '/') : l.slice(2).replace('-', '.')));
  mkChart(id, {
    type: 'line',
    data: { labels: fmtL, datasets: [line('남양주', n.map((r) => r.v), C.s1), line('경기', labels.map((l) => gm.get(l) ?? null), C.s2), line('수도권', labels.map((l) => sm.get(l) ?? null), C.s3)] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${c.parsed.y?.toFixed(2)}` } } } },
  });
  const last = n[n.length - 1];
  if (last) $(subId).textContent = `${title} · 최근 ${last.label} 남양주 ${last.v.toFixed(2)} (2026.07.06=100) · ${S.mode === 'month' ? '월말 주 기준' : '주간'}`;
}
function renderCharts() {
  indexChart('cSale', S.reb.sale || {}, '#subSale', '남양주·경기·수도권');
  indexChart('cJeonse', S.reb.jeonse || {}, '#subJeonse', '남양주·경기·수도권');
  // 수급
  const e1 = seriesWindow(S.reb.demand?.east1), gg = seriesWindow(S.reb.demand?.gg);
  const gm = new Map(gg.map((r) => [r.label, r.v]));
  mkChart('cDemand', {
    type: 'line',
    data: {
      labels: e1.map((r) => (r.label.length > 7 ? r.label.slice(5).replace('-', '/') : r.label.slice(2).replace('-', '.'))),
      datasets: [line('동부1권', e1.map((r) => r.v), C.s1), line('경기', e1.map((r) => gm.get(r.label) ?? null), C.s2),
        line('기준 100', e1.map(() => 100), '#9aa3b2', { borderWidth: 1, borderDash: [4, 4], pointHoverRadius: 0 })],
    },
    options: { plugins: { tooltip: { filter: (i) => i.datasetIndex < 2, callbacks: { label: (c) => `${c.dataset.label} ${c.parsed.y?.toFixed(1)}` } } } },
  });
  // 다산동 월별 거래량 / 평당가 (최근 12개월, 동·지구 필터 반영)
  const months = []; const now = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); }
  const agg = (kind) => months.map((m) => {
    const ds = (kind === 'trade' ? S.deals.trade : S.deals.rent).filter((d) => d.ym === m && aptPass(d.a) && (kind === 'trade' || (kind === 'jeonse' ? d.rent === 0 : d.rent > 0)));
    return { n: ds.length, ppp: ds.length ? ds.reduce((s, d) => s + val(kind, d) / (d.area / PY), 0) / ds.length : null };
  });
  const T = agg('trade'), J = agg('jeonse'), W = agg('wolse');
  const ml = months.map((m) => m.slice(2).replace('-', '.'));
  const scope = (S.dong === 'all' ? '다산동' : S.dong) + (S.district !== 'all' ? ' ' + S.district : '');
  $('#hVol').textContent = `${scope} 월별 거래량`;
  $('#hPpp').textContent = `${scope} 월별 평균 평당가`;
  const bar = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'bottom', borderColor: '#fff', borderWidth: { left: 1, right: 1 }, maxBarThickness: 18 });
  mkChart('cVol', { type: 'bar', data: { labels: ml, datasets: [bar('매매', T.map((x) => x.n), C.s1), bar('전세', J.map((x) => x.n), C.s2), bar('월세', W.map((x) => x.n), C.s3)] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${c.parsed.y}건` } } }, scales: { y: { beginAtZero: true } } } });
  mkChart('cPpp', { type: 'line', data: { labels: ml, datasets: [line('매매', T.map((x) => x.ppp && Math.round(x.ppp)), C.s1, { pointRadius: 3 }), line('전세', J.map((x) => x.ppp && Math.round(x.ppp)), C.s2, { pointRadius: 3 })] },
    options: { spanGaps: true, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${nf.format(c.parsed.y)}만/3.3㎡` } } } } });
  // 미분양
  const un = (S.reb.unsold || []).slice(-24);
  mkChart('cUnsold', { type: 'bar', data: { labels: un.map((r) => r.t.slice(2, 4) + '.' + r.t.slice(4)), datasets: [bar('남양주 미분양(호)', un.map((r) => r.v), C.s1)] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `미분양 ${nf.format(c.parsed.y)}호` } } }, scales: { y: { beginAtZero: true } } } });
}

// ---------------- 전체 렌더 ----------------
function renderAll() {
  renderKpis();
  renderSortOptions();
  renderTop10();
  renderListings();
  renderCharts();
  if (S.selected) {
    const a = S.aptByName.get(S.selected);
    if (a) { renderDetail(a); renderAnalysis(a); renderPoiLayer(a); }
  }
}

async function refresh() {
  computeRange();
  try {
    await loadDeals();
  } catch (e) {
    status('실거래 자료를 불러오지 못했습니다: ' + e.message + ' (server.mjs 실행 여부를 확인하세요)', true);
  }
  renderAll();
}

// ---------------- 이벤트 ----------------
function bindUI() {
  const segs = (id, cb) => $$(`#${id} button`).forEach((b) => b.addEventListener('click', () => { $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); }));
  segs('segDong', (v) => { S.dong = v; renderAll(); });
  segs('segMode', (v) => { S.mode = v; showDateInputs(); refresh(); });
  $('#selDistrict').addEventListener('change', (e) => { S.district = e.target.value; renderAll(); });
  $('#chkRental').addEventListener('change', (e) => { S.includeRental = e.target.checked; renderAll(); });
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => { $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); S.tab = b.dataset.v; S.selected = null; renderSortOptions(); renderTop10(); }));
  $('#selSort').addEventListener('change', (e) => { S.sort = e.target.value; renderTop10(); });
  $('#btnApply').addEventListener('click', refresh);
  ['inWeekEnd', 'inMonth', 'inFrom', 'inTo'].forEach((id) => $('#' + id).addEventListener('change', refresh));
  $('#btnShowAll').addEventListener('click', () => { S.selected = null; S.selectedListing = null; S.layers.poi.clearLayers(); S.map.closePopup(); renderTop10(); renderListings(); $('#detailCard').hidden = true; $('#analysisCard').hidden = true; });
  $('#btnAddListing').addEventListener('click', () => openListingDialog(null));
  $('#btnPrint').addEventListener('click', () => window.print());
  bindListingDialog();
  const beforePrint = () => {
    $('#printedAt').textContent = `출력일시 ${new Date().toLocaleString('ko-KR')} · 덕자부동산 Tel. 010-4703-3012`;
    S.map?.invalidateSize();
    Object.values(S.charts).forEach((c) => c.resize());
  };
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', () => { S.map?.invalidateSize(); Object.values(S.charts).forEach((c) => c.resize()); });
}
function showDateInputs() { $$('.dates').forEach((el) => el.classList.toggle('show', el.dataset.for === S.mode)); }

function initDates() {
  const t = new Date();
  const lastMonth = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  $('#inWeekEnd').value = ymd(t);
  $('#inMonth').value = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}`; // 기본: 신고가 대부분 반영된 전월
  $('#inFrom').value = ymd(addDays(t, -90));
  $('#inTo').value = ymd(t);
  $('#inWeekEnd').max = $('#inTo').max = $('#inFrom').max = ymd(t);
  $('#inMonth').max = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
}

(async function main() {
  initDates(); showDateInputs(); bindUI(); initMap();
  if (EMBED) {
    $('#dataInfo').textContent = `자료 기준: 부동산원 지수·주변시설 ${EMBED.builtAt} 내장본 · 국토부 실거래 ${EMBED.liveKey ? '최근 2개월은 열 때마다 공공데이터포털에서 실시간 갱신(인터넷 필요)' : EMBED.builtAt + ' 내장본'} · 추천매물은 이 브라우저에 저장`;
  }
  try { await loadStatic(); } catch (e) { status('기본 데이터를 읽지 못했습니다: ' + e.message, true); return; }
  renderListings();
  computeRange();
  await Promise.all([
    loadDeals().catch((e) => status('실거래 자료를 불러오지 못했습니다: ' + e.message, true)),
    loadReb().catch(() => {}),
  ]);
  renderAll();
})();
