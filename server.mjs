// 덕자부동산 · 다산 지금지구 부동산 대시보드 — 로컬 서버
// 실행: node server.mjs  →  http://localhost:8787
// - 공공데이터포털(국토교통부 실거래가) / 한국부동산원 R-ONE API 프록시 + 디스크 캐시
// - 추천매물 저장(data/listings.json)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// API 키는 config.json(깃허브에 올리지 않음) 또는 환경변수 DATA_GO_KR_KEY / REB_KEY 로 지정
const cfgPath = path.join(ROOT, fs.existsSync(path.join(ROOT, 'config.json')) ? 'config.json' : 'config.example.json');
const CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (process.env.DATA_GO_KR_KEY) CFG.dataGoKrKey = process.env.DATA_GO_KR_KEY;
if (process.env.REB_KEY) CFG.rebKey = process.env.REB_KEY;
if (!CFG.dataGoKrKey || /YOUR_/.test(CFG.dataGoKrKey)) console.warn('\n  ⚠ config.json 에 API 키를 넣어주세요 (config.example.json 복사 → config.json)\n');
const PORT = process.env.PORT || CFG.port || 8787;
const CACHE_DIR = path.join(ROOT, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const LAWD_CD = CFG.lawdCd || '41360'; // 남양주시
const UMD = CFG.umdNm || '다산동';

// ---------- 공통 유틸 ----------
const num = (s) => (s == null || s === '' ? 0 : Number(String(s).replace(/,/g, '').trim()) || 0);
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };
const ymNow = () => { const d = new Date(); return d.getFullYear() * 100 + d.getMonth() + 1; };

function cacheGet(key, maxAgeMs) {
  const f = path.join(CACHE_DIR, key.replace(/[^\w.-]/g, '_') + '.json');
  if (!fs.existsSync(f)) return null;
  const st = fs.statSync(f);
  if (maxAgeMs && Date.now() - st.mtimeMs > maxAgeMs) return { stale: JSON.parse(fs.readFileSync(f, 'utf8')) };
  return { data: JSON.parse(fs.readFileSync(f, 'utf8')) };
}
function cachePut(key, data) {
  fs.writeFileSync(path.join(CACHE_DIR, key.replace(/[^\w.-]/g, '_') + '.json'), JSON.stringify(data));
}
const inflight = new Map();
async function cached(key, maxAgeMs, loader) {
  const c = cacheGet(key, maxAgeMs);
  if (c?.data) return c.data;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try { const d = await loader(); cachePut(key, d); return d; }
    catch (e) { if (c?.stale) { console.warn('[cache] stale 사용', key, e.message); return c.stale; } throw e; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}
async function fetchText(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
      const t = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return t;
    } catch (e) { err = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw err;
}

// ---------- 국토교통부 아파트 실거래 (매매 / 전월세) ----------
export async function molit(kind, ym) {
  const svc = kind === 'trade' ? 'RTMSDataSvcAptTrade' : 'RTMSDataSvcAptRent';
  const ageMs = Number(ym) >= ymNow() - 1 ? 3 * 3600e3 : 7 * 24 * 3600e3; // 최근 2개월은 신고 추가가 잦아 3시간 캐시
  return cached(`molit-${kind}-${LAWD_CD}-${ym}`, ageMs, async () => {
    const items = [];
    for (let page = 1; page < 10; page++) {
      const url = `https://apis.data.go.kr/1613000/${svc}/get${svc}?serviceKey=${CFG.dataGoKrKey}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
      const xml = await fetchText(url);
      const code = tag(xml, 'resultCode');
      if (code && code !== '000' && code !== '00') throw new Error('실거래 API 오류 ' + code + ' ' + tag(xml, 'resultMsg'));
      const parts = xml.split('<item>').slice(1);
      for (const it of parts) {
        if (tag(it, 'umdNm') !== UMD) continue;
        const base = {
          apt: tag(it, 'aptNm'), jibun: tag(it, 'jibun'), area: num(tag(it, 'excluUseAr')), floor: num(tag(it, 'floor')),
          built: num(tag(it, 'buildYear')),
          date: `${tag(it, 'dealYear')}-${tag(it, 'dealMonth').padStart(2, '0')}-${tag(it, 'dealDay').padStart(2, '0')}`,
        };
        if (kind === 'trade') {
          if (tag(it, 'cdealType')) continue; // 해제 거래 제외
          items.push({ ...base, price: num(tag(it, 'dealAmount')), dealing: tag(it, 'dealingGbn') });
        } else {
          items.push({ ...base, deposit: num(tag(it, 'deposit')), rent: num(tag(it, 'monthlyRent')), contractType: tag(it, 'contractType') });
        }
      }
      const total = num(tag(xml, 'totalCount'));
      if (page * 1000 >= total) break;
    }
    return { ym, kind, fetchedAt: new Date().toISOString(), items };
  });
}

// ---------- 한국부동산원 R-ONE ----------
export const REB = {
  weeklySale: 'T244183132827305', // (주) 매매가격지수
  weeklyJeonse: 'T247713133046872', // (주) 전세가격지수
  weeklyDemand: 'T248163133074619', // (주) 매매수급동향
  weeklyJeonseDemand: 'T245423133086632', // (주) 전세수급동향
  unsold: 'T237973129847263', // 미분양주택현황 (월)
  aptTrade: 'A_2024_00554', // (월) 행정구역별 아파트매매거래현황
};
export async function reb(statbl, cycle, clsId, start, end) {
  const key = `reb-${statbl}-${cycle}-${clsId}-${start}-${end}`;
  const isRecent = Number(String(end).slice(0, 4)) >= new Date().getFullYear();
  return cached(key, isRecent ? 12 * 3600e3 : 30 * 24 * 3600e3, async () => {
    const url = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${CFG.rebKey}&Type=json&pIndex=1&pSize=1000&STATBL_ID=${statbl}&DTACYCLE_CD=${cycle}&CLS_ID=${clsId}&START_WRTTIME=${start}&END_WRTTIME=${end}`;
    const j = JSON.parse(await fetchText(url));
    const root = j.SttsApiTblData;
    if (!root) { const r = j.RESULT || Object.values(j)[0]?.[0]?.head?.[1]?.RESULT; if (r?.CODE === 'INFO-200') return []; throw new Error('R-ONE 오류 ' + JSON.stringify(j).slice(0, 200)); }
    const rows = root[1]?.row || [];
    return rows.map((r) => ({ t: r.WRTTIME_IDTFR_ID, label: r.WRTTIME_DESC, item: r.ITM_NM, v: r.DTA_VAL, unit: r.UI_NM }));
  });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, no) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 5e6) no(new Error('too large')); }); req.on('end', () => ok(b)); });

const LISTINGS = path.join(ROOT, 'data/listings.json');

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/deals') {
      // ?kind=trade|rent&from=YYYYMM&to=YYYYMM
      const kind = u.searchParams.get('kind') === 'rent' ? 'rent' : 'trade';
      let from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
      if (!from || !to || from > to) return send(res, 400, { error: 'from/to (YYYYMM) 필요' });
      const months = [];
      for (let y = Math.floor(from / 100), m = from % 100; y * 100 + m <= to && months.length < 36; m === 12 ? (y++, (m = 1)) : m++) months.push(`${y}${String(m).padStart(2, '0')}`);
      const out = []; const errors = [];
      // 동시 3개씩
      for (let i = 0; i < months.length; i += 3) {
        const rs = await Promise.allSettled(months.slice(i, i + 3).map((ym) => molit(kind, ym)));
        rs.forEach((r, k) => (r.status === 'fulfilled' ? out.push(...r.value.items) : errors.push(months[i + k] + ': ' + r.reason.message)));
      }
      return send(res, 200, { kind, months, count: out.length, items: out, errors });
    }
    if (u.pathname === '/api/reb') {
      const name = u.searchParams.get('table');
      const statbl = REB[name];
      if (!statbl) return send(res, 400, { error: 'unknown table' });
      const cycle = u.searchParams.get('cycle') || 'WK';
      const cls = (u.searchParams.get('cls') || '').split(',').filter(Boolean).slice(0, 6);
      const start = u.searchParams.get('start'), end = u.searchParams.get('end');
      const series = {};
      await Promise.all(cls.map(async (c) => { try { series[c] = await reb(statbl, cycle, c, start, end); } catch (e) { series[c] = { error: e.message }; } }));
      return send(res, 200, { table: name, series });
    }
    if (u.pathname === '/api/listings') {
      if (req.method === 'GET') return send(res, 200, fs.existsSync(LISTINGS) ? fs.readFileSync(LISTINGS, 'utf8') : '[]');
      if (req.method === 'PUT') {
        const list = JSON.parse(await readBody(req));
        if (!Array.isArray(list)) return send(res, 400, { error: 'array required' });
        fs.writeFileSync(LISTINGS, JSON.stringify(list, null, 1));
        return send(res, 200, { ok: true, count: list.length });
      }
    }
    if (u.pathname === '/api/health') return send(res, 200, { ok: true, lawd: LAWD_CD, umd: UMD });

    // 정적 파일 (public/, data/)
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const base = p.startsWith('/data/') ? ROOT : path.join(ROOT, 'public');
    const f = path.normalize(path.join(base, p));
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

export { CFG };
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) server.listen(PORT, () => {
  console.log(`\n  덕자부동산 다산 지금지구 대시보드 실행 중  →  http://localhost:${PORT}\n`);
  // 최근 13개월 실거래 미리 받아두기 (첫 화면 속도 개선)
  (async () => {
    const d = new Date();
    for (let i = 0; i < 13; i++) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const ym = `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}`;
      try { await molit('trade', ym); await molit('rent', ym); } catch (e) { console.warn('[prefetch]', ym, e.message); }
    }
    console.log('  [prefetch] 최근 13개월 실거래 캐시 완료');
  })();
});
