// 다산동 아파트 마스터(좌표·행정동·지구) + 주변시설(POI) 데이터 생성 스크립트
// 실행: node scripts/build-data.mjs   (OpenStreetMap Overpass / Nominatim 사용, 1회성)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'local-realestate-dashboard/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 국토부 실거래 aptNm | 지번 | 도로명 | 준공 | 위도 | 경도   (좌표는 OSM 단지 경계 중심점)
const SEED = `
다산지금A5경기행복주택|6110|다산중앙로82번길 106|2022|37.61861|127.16612
다산역자연앤푸르지오|6084|다산중앙로123번길 29|2024|37.62203|127.15066
다산지금데시앙|6109|다산중앙로82번길 105|2022|37.62079|127.16625
다산진건데시앙|6026|다산중앙로171번길 21-10|2022|37.62741|127.14865
다산포레스트2단지아파트|6013|다산순환로 311|2023|37.62926|127.15705
다산센트럴파크|6107|다산중앙로82번길 87-17|2021|37.62208|127.16340
다산역경기행복주택|6027|다산중앙로145번길 38|2019|37.62591|127.14853
다산메트로3단지|6076|다산중앙로123번길 47|2021|37.62228|127.14817
다산 이편한세상자이|6133|다산중앙로81번길 25|2018|37.61935|127.15231
e편한세상 다산|6091|다산중앙로82번길 15|2017|37.62255|127.15577
다산롯데캐슬|6029|다산중앙로146번길 7|2017|37.62722|127.15408
다산신안인스빌퍼스트포레|6213|다산지금로123번길 17|2020|37.60288|127.17633
힐스테이트다산|6092|다산순환로 365|2018|37.62337|127.15813
다산반도유보라메이플타운|6014|다산순환로 300|2018|37.62981|127.15410
다산한강반도유보라|6234|다산지금로146번길 67|2019|37.59859|127.16915
다산유승한내들센트럴|6090|다산중앙로81번길 10|2018|37.62165|127.15310
다산펜테리움리버테라스Ⅱ|6235|다산지금로146번길 117|2019|37.59841|127.17176
다산푸르지오|6163|다산중앙로82번안길 74|2021|37.61495|127.16452
다산한양수자인리버팰리스|6024|다산순환로 171|2017|37.62543|127.14628
플루리움4,5단지|4002-1|도농로 34|2000|37.61076|127.16103
플루리움2단지|4002-1|도농로 34|2002|37.61303|127.15943
힐스테이트 황금산|3720|경춘로 468-40|2017|37.60764|127.16458
다산신안인스빌퍼스트리버|6251|다산지금로146번길 100|2019|37.59559|127.17016
다산자이아이비플레이스|6028|다산중앙로 153|2021|37.62703|127.15117
다산 펜테리움 리버테라스 Ⅰ|6215|다산지금로145번길 15|2018|37.60079|127.17638
다산자연앤e편한세상3차|6132|다산중앙로82번길 12|2019|37.61933|127.15625
플루리움3단지|4002-1|도농로 34|2001|37.61269|127.16297
다산자이폴라리스|6015|다산순환로 242|2021|37.62979|127.15052
다산아이파크|6031|다산순환로 333|2017|37.62705|127.15678
다산지금센트럴에일린의뜰|6208|다산지금로16번길 88|2019|37.60703|127.17173
롯데낙천대|4433|미금로 24|2005|37.60777|127.15322
다산해모로|6297|미금로19번길 9|2021|37.60584|127.15177
플루리움1단지|4002-1|도농로 34|2001|37.61028|127.15770
한화꿈에그린|3718|다산지금로16번길 56|2008|37.60794|127.16777
다산유승한내들골든뷰|6025|다산순환로 135|2018|37.62203|127.14599
다산e편한세상더퍼스트|6151|다산중앙로20번길 7|2019|37.61624|127.15649
다산센트레빌|4436|미금로 16|2016|37.60657|127.15389
다산한양수자인리버파크|6075|다산순환로 111|2018|37.62032|127.14682
다산리버펠리체2단지|4432-2|미금로57번길 22|2005|37.60723|127.15050
경남아너스빌|683|가운로2길 111|2008|37.59963|127.15948
휴먼시아1단지|669|가운로2길 28|2008|37.60253|127.15579
해링턴플레이스다산파크|6302|미금로 98|2024|37.61226|127.15437
다산유보라마크뷰|4438|경춘로 355|2024|37.60551|127.15403
부영사랑으로7단지|4435|도농로 71|2013|37.61100|127.15546
다산리버펠리체1단지|4432|미금로57번길 20|2005|37.60853|127.15049
다산한신휴플러스|4026-6|미금로56번길 19|1999|37.61041|127.15360
동원베네스트|3395|미금로 159|2005|37.61668|127.16005
다산효성해링턴타워|4434|경춘로 377|2010|37.60602|127.15607
더힐포레4단지|673|가운로2길 11|2008|37.60179|127.15854
더힐포레3단지|674|가운로2길 43|2008|37.60220|127.15660
다산리버펠리체3단지|4432-4|미금로57번길 42|2005|37.60591|127.15030
부영사랑으로|3717|미금로189번길 7|2007|37.61532|127.16216
휴먼시아2단지|671|가운로2길 8|2008|37.60371|127.15833
다산 한신 더휴 6단지|682|가운로2길 79|2009|37.59841|127.15890
다산 한신 더휴 7단지|681|가운로2길 78|2009|37.59824|127.15750
다산 한신 더휴 8단지|690|가운로2길 98|2009|37.59766|127.16008
신우가든|4026-16|미금로56번길|1990|37.61071|127.15466
충일|3135-3|경춘로 462-8|1994||
창조|4296-15|미금로 36-21|1995||
부영애시앙|4001-29|도농로 24|2008||
제일|4027-5|미금로42번길 13|1988||
건영|4047-18|미금로20번길 48-15|2005||
양지B동|4047-5|미금로20번길 48-10|2004||
양지A동|4047-4|미금로20번길 48-12|2004||
동화|4025-32|도농로중촌2길 26-3|2002||
동양|4050-1|미금로20번길 31-1|2002||
아림|4047-10|미금로20번길 48-7|2003||
`;

// 공공임대(매매 거래 없음) — 순위 기본 제외
const RENTAL = /행복주택|휴먼시아|자연앤푸르지오$|다산진건데시앙|다산지금데시앙|다산포레스트2단지|다산센트럴파크|다산메트로3단지/;

function districtOf(a) {
  const isNew = /^6\d{3}/.test(a.jibun) && !['6297', '6302'].includes(a.jibun);
  if (!isNew) return '도농·지금 생활권(기존)';
  return a.lng >= 127.16 ? '지금지구' : '진건지구';
}

async function nominatim(params) {
  const u = 'https://nominatim.openstreetmap.org/' + params + '&format=json&accept-language=ko&addressdetails=1';
  const r = await fetch(u, { headers: UA });
  await sleep(1100);
  return r.json();
}

async function buildApartments() {
  const out = [];
  for (const line of SEED.trim().split('\n')) {
    const [name, jibun, road, built, lat, lng] = line.split('|');
    const a = { id: 'A' + String(out.length + 1).padStart(3, '0'), name, jibun, road, built: +built, lat: lat ? +lat : null, lng: lng ? +lng : null };
    if (!a.lat) {
      const j = await nominatim('search?countrycodes=kr&limit=1&q=' + encodeURIComponent('남양주시 ' + road.replace(/\s[\d-]+$/, '')));
      if (j[0]) { a.lat = +(+j[0].lat).toFixed(5); a.lng = +(+j[0].lon).toFixed(5); a.approx = true; }
    }
    if (a.lat) {
      const rv = await nominatim(`reverse?zoom=16&lat=${a.lat}&lon=${a.lng}`);
      const addr = rv.address || {};
      const s = [addr.suburb, addr.city_district, addr.quarter, rv.display_name].join(' ');
      a.hdong = /다산2동/.test(s) ? '다산2동' : /다산1동/.test(s) ? '다산1동' : '다산동';
    } else a.hdong = '다산동';
    a.district = a.lat ? districtOf(a) : '도농·지금 생활권(기존)';
    a.rental = RENTAL.test(name);
    out.push(a);
    console.log(a.id, a.name, a.hdong, a.district, a.lat, a.lng);
  }
  fs.writeFileSync(path.join(ROOT, 'data/apartments.json'), JSON.stringify(out, null, 1));
}

async function buildPois() {
  const rawPath = path.join(ROOT, 'cache/osm-raw.json');
  const bb = '37.575,127.105,37.670,127.205';
  let raw;
  if (fs.existsSync(rawPath)) raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  else {
    const qa = `[out:json][timeout:120];(nwr["amenity"~"^(school|kindergarten|townhall|police|post_office|library|hospital|cafe|bank|fire_station|community_centre|clinic)$"](${bb});nwr["office"="government"](${bb});nwr["shop"~"^(supermarket|department_store|mall)$"](${bb});nwr["leisure"="park"]["name"](${bb});node["highway"="bus_stop"](${bb}););out center tags;`;
    const ra = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(qa), headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' } });
    raw = await ra.json();
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(raw));
  }
  // 버스노선 relation (정류장별 노선번호)
  const q = `[out:json][timeout:120];node["highway"="bus_stop"](${bb})->.s;rel(bn.s)["route"="bus"];out body;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' } });
  const routes = r.ok ? (await r.json()).elements : [];
  const stopRoutes = {};
  for (const rel of routes) {
    const ref = rel.tags?.ref || rel.tags?.name;
    if (!ref) continue;
    for (const m of rel.members || []) if (m.type === 'node') (stopRoutes[m.ref] ||= new Set()).add(ref);
  }
  const P = [];
  const seen = new Set();
  const add = (cat, e, extra = {}) => {
    const t = e.tags; const lat = e.lat ?? e.center?.lat; const lng = e.lon ?? e.center?.lon;
    if (!t.name || lat == null) return;
    const key = cat + t.name + lat.toFixed(3) + lng.toFixed(3);
    if (seen.has(key)) return; seen.add(key);
    P.push({ cat, name: t.name, lat: +lat.toFixed(5), lng: +lng.toFixed(5), ...extra });
  };
  for (const e of raw.elements) {
    const t = e.tags || {};
    if (t.highway === 'bus_stop') { const rs = stopRoutes[e.id]; add('bus', e, rs ? { routes: [...rs].sort().slice(0, 12) } : {}); continue; }
    if (t.amenity === 'school') {
      const n = t.name; const lv = /초등/.test(n) ? 'elem' : /중고등|중·고/.test(n) ? 'midhigh' : /중학/.test(n) ? 'mid' : /고등/.test(n) ? 'high' : null;
      if (lv === 'midhigh') { add('mid', e); add('high', e); } else if (lv) add(lv, e);
      continue;
    }
    if (t.amenity === 'kindergarten') { add('kinder', e); continue; }
    if (t.shop === 'department_store' || /백화점|아울렛/.test(t.name || '')) { add('dept', e); continue; }
    if (t.shop === 'supermarket' || t.shop === 'mall') { if (/이마트|E-Mart|홈플러스|롯데마트|Lotte mart|하나로마트|코스트코|트레이더스|노브랜드|롯데슈퍼|롯데프레쉬|GS슈퍼|식자재/.test(t.name || '')) add('mart', e); continue; }
    if (t.amenity === 'cafe') { add('cafe', e); continue; }
    if (t.amenity === 'hospital') { if (/병원|의료원/.test(t.name || '') && !/장례|요양/.test(t.name)) add('hospital', e); continue; }
    if (t.amenity === 'bank') { add('bank', e); continue; }
    if (['townhall', 'police', 'post_office', 'fire_station'].includes(t.amenity) || t.office === 'government') { if (!/마을회관|노인회관|주민자치/.test(t.name || '')) add('gov', e); continue; }
    if (t.amenity === 'library') { add('library', e); continue; }
    if (t.leisure === 'park' && /공원/.test(t.name || '')) { add('park', e); continue; }
  }
  // 철도역 (노선 수동 정리 — OSM 역 좌표 사용)
  const stations = [
    { name: '다산역', lines: ['8호선(별내선)'], lat: 37.62433, lng: 127.14976 },
    { name: '동구릉역', lines: ['8호선(별내선)'], lat: 37.61051, lng: 127.13811 },
    { name: '구리역', lines: ['경의중앙선', '8호선(별내선)'], lat: 37.60325, lng: 127.14337 },
    { name: '도농역', lines: ['경의중앙선'], lat: 37.60878, lng: 127.16119 },
    { name: '양정역', lines: ['경의중앙선'], lat: 37.60402, lng: 127.19461 },
    { name: '별내역', lines: ['경춘선', '8호선(별내선)'], lat: 37.64233, lng: 127.12761 },
    { name: '퇴계원역', lines: ['경춘선'], lat: 37.64826, lng: 127.14353 },
    { name: '갈매역', lines: ['경춘선'], lat: 37.63395, lng: 127.11473 },
  ];
  for (const s of stations) P.push({ cat: 'subway', ...s });
  const ktx = [
    { name: '청량리역', lines: ['KTX 강릉선', 'KTX-이음 중앙선', '1호선', '경의중앙선'], lat: 37.58040, lng: 127.04697 },
    { name: '상봉역', lines: ['KTX 강릉선(일부)', '7호선', '경의중앙선', '경춘선'], lat: 37.59680, lng: 127.08530 },
  ];
  for (const s of ktx) P.push({ cat: 'ktx', ...s });
  fs.writeFileSync(path.join(ROOT, 'data/pois.json'), JSON.stringify(P));
  const c = {}; for (const p of P) c[p.cat] = (c[p.cat] || 0) + 1; console.log('POI', c, 'bus routes', routes.length);
}

await buildPois();
await buildApartments();
