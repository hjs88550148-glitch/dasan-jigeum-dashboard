// 단일 파일 index.html 생성 (서버 없이 더블클릭으로 열리는 대시보드)
// 실행: node scripts/build-index.mjs            → ./index.html
//       → index.html(키 없음, 공유용) + index-live.html(키 포함, 내 PC 전용)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { molit, reb, REB, CFG } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const noKey = process.argv.includes('--no-key');
const MONTHS = 25; // 내장 실거래 기간(개월)

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const builtYm = now.getFullYear() * 100 + now.getMonth() + 1;

// 1) 국토부 실거래 (다산동, 최근 25개월) — 압축 배열로 저장
const deals = { trade: {}, rent: {} };
for (let i = 0; i < MONTHS; i++) {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  const ym = `${d.getFullYear()}${pad(d.getMonth() + 1)}`;
  for (const kind of ['trade', 'rent']) {
    try {
      const { items } = await molit(kind, ym);
      deals[kind][ym] = items.map((x) => kind === 'trade'
        ? [x.apt, x.jibun, x.area, x.floor, x.date, x.price]
        : [x.apt, x.jibun, x.area, x.floor, x.date, x.deposit, x.rent]);
    } catch (e) { console.warn('실거래 실패', kind, ym, e.message); }
  }
  process.stdout.write(`\r실거래 ${i + 1}/${MONTHS}`);
}
console.log();

// 2) 한국부동산원 R-ONE 스냅샷 (브라우저 직접 호출 불가 → 내장)
const y = now.getFullYear();
const rebSpec = [
  ['weeklySale', 'WK', ['50107', '50016', '50002'], `${y - 2}01`, `${y}53`],
  ['weeklyJeonse', 'WK', ['50107', '50016', '50002'], `${y - 2}01`, `${y}53`],
  ['weeklyDemand', 'WK', ['50020', '50016'], `${y - 2}01`, `${y}53`],
  ['unsold', 'MM', ['50250'], `${y - 2}01`, `${y}12`],
];
const rebOut = {};
for (const [name, cycle, clsList, start, end] of rebSpec) {
  rebOut[name] = {};
  for (const cls of clsList) {
    try { rebOut[name][cls] = await reb(REB[name], cycle, cls, start, end); }
    catch (e) { console.warn('부동산원 실패', name, cls, e.message); rebOut[name][cls] = []; }
  }
}

// 3) 내장 데이터
const listingsPath = path.join(ROOT, 'data/listings.json');
const EMBED = {
  builtAt: `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`,
  builtYm,
  lawdCd: CFG.lawdCd || '41360',
  umdNm: CFG.umdNm || '다산동',
  liveKey: '__LIVEKEY__',
  apartments: JSON.parse(rd('data/apartments.json')),
  pois: JSON.parse(rd('data/pois.json')),
  development: JSON.parse(rd('data/development.json')),
  listings: fs.existsSync(listingsPath) ? JSON.parse(fs.readFileSync(listingsPath, 'utf8')) : [],
  deals,
  reb: rebOut,
};

// 4) HTML 조립 (CSS·JS·로고 인라인)
const logo = 'data:image/svg+xml;base64,' + Buffer.from(rd('public/logo.svg')).toString('base64');
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
let html = rd('public/index.html');
const swap = (from, to) => { if (!html.includes(from)) throw new Error('템플릿에서 찾을 수 없음: ' + from); html = html.split(from).join(to); };
swap('<link rel="stylesheet" href="style.css">', `<style>\n${rd('public/style.css')}\n</style>`);
swap('<script src="app.js"></script>', `<script>window.__EMBED__=${safe(JSON.stringify(EMBED))};</script>\n<script>\n${safe(rd('public/app.js'))}\n</script>`);
swap('href="logo.svg"', `href="${logo}"`);
swap('src="logo.svg"', `src="${logo}"`);

// index.html      : API 키 없음 (깃허브·외부 공유용, 내장 자료만 사용)
// index-live.html : API 키 포함 (내 PC 전용, 최근 2개월 실거래 실시간 갱신) — .gitignore 대상
const n = (k) => Object.values(deals[k]).reduce((s, a) => s + a.length, 0);
const outputs = [['index.html', false]];
if (!noKey && CFG.dataGoKrKey && !/YOUR_/.test(CFG.dataGoKrKey)) outputs.push(['index-live.html', true]);
for (const [file, withKey] of outputs) {
  const doc = html.replace('__LIVEKEY__', withKey ? CFG.dataGoKrKey : '');
  fs.writeFileSync(path.join(ROOT, file), doc);
  console.log(`완료: ${file}  (${(Buffer.byteLength(doc) / 1024 / 1024).toFixed(2)} MB, 매매 ${n('trade')}건 · 전월세 ${n('rent')}건, 실시간 갱신 ${withKey ? '켜짐' : '꺼짐'})`);
}
process.exit(0);
