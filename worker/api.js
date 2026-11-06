const REB = 'https://www.reb.or.kr/r-one/openapi/';
const now = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul'}).format(new Date());
const pad = n => String(n).padStart(2,'0');
const xml = (row, tag) => row.match(new RegExp('<'+tag+'>([^<]*)</'+tag+'>','i'))?.[1].trim().replaceAll('&amp;','&') ?? '';
const cache = new Map();
async function memo(key, minutes, fn) {
  const hit = cache.get(key);
  if (hit?.until > Date.now()) return hit.value;
  const value = fn();
  if (cache.size > 150) cache.delete(cache.keys().next().value);
  cache.set(key,{value,until:Date.now()+minutes*60000});
  try { return await value; }
  catch (e) { if (cache.get(key)?.value === value) cache.delete(key); throw e; }
}
async function request(base, params) {
  const u = new URL(base);
  u.search = new URLSearchParams(params);
  const r = await fetch(u,{signal:AbortSignal.timeout(14000)});
  if (!r.ok) throw new Error('외부 서비스 HTTP '+r.status);
  return r;
}
function months(start,end) {
  const d = new Date(start.slice(0,7)+'-01T00:00:00Z');
  const list = [];
  while (d.toISOString().slice(0,7) <= end.slice(0,7)) {
    list.push(d.toISOString().slice(0,7).replace('-',''));
    d.setUTCMonth(d.getUTCMonth()+1);
  }
  return list;
}
async function molit(env, type, month) {
  if (!env.MOLIT_KEY) throw new Error('국토교통부 API 키 설정 필요');
  return memo(type+month,20,async () => {
    const service = type==='sale'?'RTMSDataSvcAptTrade':'RTMSDataSvcAptRent';
    const output = [];
    for (let page=1; page<=20; page++) {
      const r = await request('https://apis.data.go.kr/1613000/'+service+'/get'+service,{
        serviceKey:env.MOLIT_KEY,LAWD_CD:'41360',DEAL_YMD:month,pageNo:page,numOfRows:1000
      });
      const body = await r.text();
      const code = xml(body,'resultCode') || xml(body,'returnReasonCode');
      if (!['0','00','000'].includes(code)) throw new Error('국토교통부 API 응답 오류'+( /^\d+$/.test(code)?' ('+code+')':''));
      for (const item of body.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const get = key => xml(item[1],key);
        if (get('umdNm') !== '다산동' || /[0-9]/.test(get('cdealDay'))) continue;
        const money = key => Number(get(key).replaceAll(',',''));
        const amount = money(type==='sale'?'dealAmount':'deposit');
        const rent = money('monthlyRent');
        const name = get('aptNm'), lot = get('jibun');
        if (!name || !amount) continue;
        output.push({name,lot,id:name+'|'+lot,area:Number(get('excluUseAr')),floor:get('floor'),
          date:get('dealYear')+'-'+pad(get('dealMonth'))+'-'+pad(get('dealDay')),amount,rent,
          type:type==='sale'?'sale':rent>0?'monthly':'lease'});
      }
      if (page*1000 >= Number(xml(body,'totalCount'))) return output;
    }
    throw new Error('응답 건수가 조회 한도를 초과했습니다');
  });
}
function validDate(s) {
  return /^\d{4}-\d\d-\d\d$/.test(s || '') && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
}
async function trades(p,env) {
  const start=p.get('start'), end=p.get('end'), type=p.get('type'), id=p.get('id');
  if (!validDate(start)||!validDate(end)||start>end||end>now()||start<'2011-01-01'||!['sale','lease','monthly'].includes(type)||months(start,end).length>12) return Response.json({error:'날짜와 거래 유형을 확인해 주세요. 최대 12개월까지 조회할 수 있습니다.'},{status:400});
  const all = (await Promise.all(months(start,end).map(m=>molit(env,type==='sale'?'sale':'rent',m)))).flat();
  const rows = all.filter(x=>x.date>=start&&x.date<=end&&x.type===type&&(!id||x.id===id)).sort((a,b)=>b.date.localeCompare(a.date));
  return Response.json({rows:id?rows.slice(0,5):rows});
}
async function reb(env) {
  if (!env.REB_KEY) throw new Error('한국부동산원 API 키 설정 필요');
  return memo('reb',60,async()=>{
    const start=String(Number(now().slice(0,4))-1);
    const r=await request(REB+'SttsApiTblData.do',{KEY:env.REB_KEY,Type:'json',pSize:100,STATBL_ID:'A_2024_00045',DTACYCLE_CD:'MM',CLS_ID:'520036',START_WRTTIME:start});
    const j=await r.json();
    const data=j.SttsApiTblData?.flatMap(x=>x.row||[])||[];
    const last=data.filter(x=>String(x.CLS_ID)==='520036'&&x.DTA_VAL!=null&&x.UI_NM!=='%').sort((a,b)=>String(b.WRTTIME_IDTFR_ID).localeCompare(String(a.WRTTIME_IDTFR_ID)))[0];
    if (!last) throw new Error('R-ONE 지수 공표값 없음');
    return {value:last.DTA_VAL,period:last.WRTTIME_DESC||last.WRTTIME_IDTFR_ID};
  });
}
async function places() {
  return memo('places',120,async()=>{
    const b='37.578,127.126,37.642,127.207';
    const q='[out:json][timeout:10];(nwr[landuse=residential][name]('+b+');nwr[building=apartments][name]('+b+');nwr[railway=station][name](37.58,127.08,37.65,127.22);node[highway=bus_stop][name]('+b+');nwr[amenity~"^(school|cafe|townhall)$"][name]('+b+');nwr[shop~"^(supermarket|department_store|mall)$"][name]('+b+');nwr[office=government][name]('+b+'););out center;';
    let data;
    for(const endpoint of ['https://overpass.kumi.systems/api/interpreter','https://overpass-api.de/api/interpreter']){
      try { data=await (await request(endpoint,{data:q})).json(); if (Array.isArray(data.elements)) break; } catch {}
    }
    if (!Array.isArray(data?.elements)) throw new Error('지도 위치 데이터 연결 지연');
    return data.elements.map(x=>{
      const t=x.tags, name=t['name:ko']||t.name;
      const kind=t.railway?'rail':t.highway?'bus':t.amenity||t.shop||(t.office?'townhall':'apt');
      return {name,kind,lat:x.lat??x.center?.lat,lon:x.lon??x.center?.lon};
    }).filter(x=>x.lat&&x.lon&&x.name);
  });
}

async function geocode(name) {
  if (!name || name.length > 80) return null;
  const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/[\s·&()\-,]/g,'').replace(/아파트$/,'').replace(/금강(?=펜테리움)/,'').replace(/리버테라스1$/,'리버테라스i').replace(/리버테라스2$/,'리버테라스ii');
  return memo('geo:'+name,180,async()=>{
    const params={q:name,limit:'12',bbox:'127.126,37.578,127.207,37.642',lat:'37.605',lon:'127.163'};
    const response=await request('https://photon.komoot.io/api/',params);
    const payload=await response.json();
    const hits=(payload.features||[]).filter(f=>f.properties?.name&&normalize(f.properties.name)===normalize(name)&&f.geometry?.type==='Point');
    if (hits.length===0) return null;
    const [lon,lat]=hits[0].geometry.coordinates;
    if(hits.some(f=>Math.hypot(f.geometry.coordinates[0]-lon,f.geometry.coordinates[1]-lat)>.004)) return null;
    return {name,kind:'apt',lat,lon};
  });
}

export default {async fetch(req,env) {
  const u=new URL(req.url);
  try {
    if (u.pathname==='/'||u.pathname==='/index.html') return new Response(page,{headers:{'content-type':'text/html; charset=utf-8'}});
    if (u.pathname==='/api/trades') return await trades(u.searchParams,env);
    if (u.pathname==='/api/index') return Response.json(await reb(env));
    if (u.pathname==='/api/places') return Response.json(await places());
    if (u.pathname==='/api/geocode') return Response.json(await geocode(u.searchParams.get('name')));
    return new Response('Not found',{status:404});
  } catch(e) {
    const message=e.message;
    return Response.json({error:/^(국토교통부|한국부동산원|R-ONE|지도|응답 건수)/.test(message)?message:'데이터 제공기관에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.'},{status:502});
  }
}};
