const $=id=>document.getElementById(id);
const types={sale:'매매',lease:'전세',monthly:'월세'};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
const day=(date,delta)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)};
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[\s·&()\-,]/g,'').replace(/아파트$/,'').replace(/금강(?=펜테리움)/,'').replace(/리버테라스1$/,'리버테라스i').replace(/리버테라스2$/,'리버테라스ii');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=x=>Number(x).toLocaleString('ko-KR');
const won=x=>x>=10000 ? Math.floor(x/10000)+'억'+(x%10000?' '+n(x%10000)+'만':'') : n(x)+'만';
const price=x=>x.rent ? won(x.amount)+' / 월 '+won(x.rent) : won(x.amount);
const mapLink=q=>'https://map.naver.com/p/search/'+encodeURIComponent(q);
const areaLabels={all:'다산동 전체',jigeum:'지금지구 주요 단지',1:'다산1동 확인 단지',2:'다산2동 확인 단지'};
const jigeum=/퍼스트포레|퍼스트리버|펜테리움리버테라스|지금센트럴에일린|지금반도유보라|신도시자연푸르지오/;
const first=/자이아이비플레이스|자이폴라리스|이편한세상자이|플루리움|자연앤e편한세상|자연e편한세상/;
const second=/힐스테이트황금산|한화꿈에그린/;
const matchArea=(x,a)=>a==='all'||(a==='jigeum'?jigeum.test(norm(x.name)):a==='2'?jigeum.test(norm(x.name))||second.test(norm(x.name)):first.test(norm(x.name)));
const samples=[
 {name:'다산신안인스빌퍼스트포레',type:'sale',price:'가격 협의',memo:'전용 84㎡ 타입 상담'},
 {name:'다산신안인스빌퍼스트리버',type:'lease',price:'보증금 상담',memo:'입주 가능 일정 확인'},
 {name:'다산펜테리움리버테라스Ⅰ',type:'monthly',price:'보증금·월세 협의',memo:'보증금 조정 문의'},
 {name:'다산펜테리움리버테라스Ⅱ',type:'sale',price:'가격 협의',memo:'층·향별 매물 상담'}
];
let saved=[];
try {saved=JSON.parse(localStorage.getItem('deokja-listings')||'[]');if(!Array.isArray(saved))saved=[];} catch {}
let type='sale', data=[], top=[], selected=null, points=[], map, layer, query=0, selection=0;
let placeState='불러오는 중';
const coordinates=new Map();
// Address coordinates for the four featured complexes, verified against Findby.
const knownCoordinates={
  '다산신안인스빌퍼스트포레':{lot:'6213',lat:37.6023797,lon:127.175803},
  '다산신안인스빌퍼스트리버':{lot:'6251',lat:37.5954482,lon:127.1711326},
  '다산펜테리움리버테라스i':{lot:'6215',lat:37.6011022,lon:127.1763893},
  '다산펜테리움리버테라스ii':{lot:'6235',lat:37.5981301,lon:127.1713667}
};
function buttonGroup(selector,value,field) {
  document.querySelectorAll(selector).forEach(b=>{const on=b.dataset[field]===value;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
}
async function json(url) {
  const r=await fetch(url);
  const j=await r.json();
  if(!r.ok)throw new Error(j.error||'데이터를 불러오지 못했습니다');
  return j;
}
function dates(span) {
  $('end').value=span==='7'?today:day(today.slice(0,7)+'-01',-1);
  $('start').value=span==='7'?day(today,-6):$('end').value.slice(0,7)+'-01';
  buttonGroup('[data-span]',span,'span');
}
function status(message,error=false) {$('status').textContent=message;$('status').dataset.error=error}
function aggregate(rows) {
  const groups=new Map();
  for(const x of rows){
    if(!groups.has(x.id))groups.set(x.id,{...x,count:0});
    groups.get(x.id).count++;
  }
  return [...groups.values()].sort((a,b)=>b.count-a.count||b.date.localeCompare(a.date)||a.name.localeCompare(b.name,'ko'));
}
function drawRows(empty='선택 기간에 신고된 거래가 없습니다.') {
  $('rank').innerHTML=top.map((x,i)=>'<tr class="'+(x.id===selected?.id?'selected':'')+'"><td><span class="rank">'+(i+1)+'</span></td><td><button type="button" class="name" data-rank="'+i+'">'+esc(x.name)+'</button><div class="muted">다산동 '+esc(x.lot)+'</div></td><td>'+x.count+'건</td><td><strong>'+esc(price(x))+'</strong><div class="muted">'+esc(x.date)+' · '+x.area+'㎡</div></td></tr>').join('')||'<tr><td colspan="4" class="empty">'+esc(empty)+'</td></tr>';
}
function filter() {
  const a=$('area').value;
  const rows=data.filter(x=>matchArea(x,a));
  const groups=aggregate(rows);
  top=groups.slice(0,10);
  $('count').textContent=n(rows.length)+'건';
  $('complexes').textContent=n(groups.length)+'곳';
  $('medianTitle').textContent=type==='monthly'?'월세 중간값':type==='lease'?'전세보증금 중간값':'매매가 중간값';
  const vals=rows.map(x=>type==='monthly'?x.rent:x.amount).sort((x,y)=>x-y);
  const mid=(vals.length-1)/2;
  $('median').textContent=vals.length?won((vals[Math.floor(mid)]+vals[Math.ceil(mid)])/2):'—';
  status(areaLabels[a]+'  ·  '+$('start').value+' ~ '+$('end').value+'  ·  '+types[type]+'  ·  국토교통부 실거래');
  $('known').innerHTML=[...new Set([...groups.map(x=>x.name),...samples.map(x=>x.name)])].map(x=>'<option value="'+esc(x)+'">').join('');
  clearSelection();
}
async function load() {
  if(!$('filters').reportValidity())return;
  const token=++query;
  data=[];top=[];
  for(const id of ['count','complexes','median'])$(id).textContent='—';
  clearSelection();
  drawRows('신고 자료를 불러오는 중입니다.');
  status('국토교통부 신고 자료 조회 중…');
  try {
    const params=new URLSearchParams({start:$('start').value,end:$('end').value,type});
    const result=await json('/api/trades?'+params);
    if(token!==query)return;
    data=result.rows;
    filter();
  }catch(e){
    if(token!==query)return;
    drawRows('조회에 실패했습니다. 실거래 조회 버튼으로 다시 시도할 수 있습니다.');
    status(e.message,true);
  }
}
function resolve(x) {
  const name=norm(x.name);
  const known=Object.hasOwn(knownCoordinates,name)?knownCoordinates[name]:null;
  if(known&&(!x.lot||x.lot===known.lot))return known;
  const hits=points.filter(p=>p.kind==='apt'&&norm(p.name)===name);
  if(hits.some(p=>Math.hypot(p.lat-hits[0].lat,p.lon-hits[0].lon)>.006))return null;
  return hits[0]||coordinates.get(name);
}
async function locateVisible(){
  const names=[...new Set((selected?[selected]:top).filter(x=>!resolve(x)&&!coordinates.has(norm(x.name))).map(x=>x.name))];
  await Promise.all(names.map(async name=>{
    const key=norm(name);
    coordinates.set(key,null);
    try {coordinates.set(key,await json('/api/geocode?'+new URLSearchParams({name})))}
    catch {coordinates.delete(key)}
  }));
  if(names.length){drawMap();drawLocation()}
}
function drawMap() {
  $('maptitle').textContent=selected?selected.name:'Top 10 위치 지도';
  $('mapcaption').textContent=selected?'선택 단지 · 최근 6개월 신고 자료':'순위 번호를 누르면 단지 브리핑을 열 수 있습니다';
  $('reset').hidden=!selected;
  const items=(selected?[selected]:top).map((x,i)=>({x,i,p:resolve(x)}));
  const missing=items.filter(v=>!v.p);
  $('mapnote').innerHTML=missing.length?'지도 위치 '+(items.length-missing.length)+'/'+items.length+'곳 · 위치 검색 '+missing.map(v=>'<a href="'+mapLink('남양주 다산동 '+v.x.name)+'" target="_blank" rel="noopener">'+esc(v.x.name)+'</a>').join(' · '):items.length?'지도 위치 '+items.length+'곳 · OpenStreetMap / 주소 좌표':'다산동 주변 지도';
  if(!map)return;
  layer.clearLayers();
  const bounds=[];
  for(const {x,i,p} of items){
    if(!p)continue;
    const ll=[p.lat,p.lon];
    bounds.push(ll);
    L.marker(ll,{title:x.name,alt:x.name,icon:L.divIcon({className:'pin'+(selected?' focus':''),html:selected?'●':String(i+1),iconSize:[30,30],iconAnchor:[15,15]})}).addTo(layer).on('click',()=>choose(x));
  }
  if(bounds.length===1)map.setView(bounds[0],16);
  else if(bounds.length>1)map.fitBounds(bounds,{padding:[34,34],maxZoom:15});
  else map.setView([37.605,127.163],13);
}
function clearSelection(){
  ++selection;selected=null;$('latest').innerHTML='';
  drawRows();drawMap();drawLocation();
  if(placeState!=='불러오는 중')locateVisible();
}
const categories=[
 ['교통',[['KTX','상봉역 KTX',p=>p.kind==='rail'&&p.name.includes('상봉')],['전철','다산역 도농역',p=>p.kind==='rail'&&!/상봉/.test(p.name)],['버스','버스정류장',p=>p.kind==='bus']]],
 ['학군',[['초등학교','초등학교',p=>p.kind==='school'&&p.name.includes('초등학교')],['중학교','중학교',p=>p.kind==='school'&&/중학교$/.test(p.name)],['고등학교','고등학교',p=>p.kind==='school'&&/고등학교$/.test(p.name)]]],
 ['상권·생활',[['마트','마트',p=>p.kind==='supermarket'],['백화점·쇼핑몰','현대프리미엄아울렛 스페이스원',p=>['mall','department_store'].includes(p.kind)],['카페','카페',p=>p.kind==='cafe'],['관공서','행정복지센터',p=>p.kind==='townhall']]]
];
const jigeumPlaces={'초등학교':'다산한강초등학교','중학교':'다산한강중학교','고등학교':'가운고등학교','관공서':'다산2동행정복지센터'};
function drawLocation(){
  $('locationtitle').textContent=selected?selected.name+' · 가까운 시설(직선거리) 및 주변 사업':'순위 또는 추천매물에서 단지를 선택하세요';
  if(!selected){$('locationgrid').innerHTML='';return}
  const point=resolve(selected);
  const near=p=>111.2*Math.hypot(p.lat-point.lat,(p.lon-point.lon)*Math.cos(point.lat*Math.PI/180));
  $('locationgrid').innerHTML=categories.map(([title,cats])=>'<article class="mini"><h3>'+title+'</h3>'+cats.map(([label, fallback, test])=>{
    const best=point?points.filter(test).sort((a,b)=>near(a)-near(b))[0]:null;
    const name=best?.name||(jigeum.test(norm(selected.name))?jigeumPlaces[label]:null)||fallback;
    const term=label==='KTX'?name:'남양주 다산동 '+name;
    return '<p><small>'+label+'</small><a href="'+mapLink(term)+'" target="_blank" rel="noopener">'+esc(name)+'</a>'+(best?' · '+near(best).toFixed(1)+'km':' <small>지도에서 확인</small>')+'</p>';
  }).join('')+(title==='학군'?'<p class="muted">통학구역과 실제 배정은 교육지원청 확인</p>':'')+'</article>').join('')+
  '<article class="mini"><h3>주변 개발계획</h3><p><a href="https://buy.gh.or.kr/land/svc/board/board_list.jsp?MenuId=BRD_NOTICE%3FBoardId%3DNOTICE" target="_blank" rel="noopener">다산 지금지구 사업용지</a><small>GH 공급·입찰 공지</small></p><p><a href="https://apply.lh.or.kr/lhapply/apply/noti/an/view.do?bbsSn=7000018766&amp;ccrCnntSysDsCd=01&amp;mi=1079" target="_blank" rel="noopener">남양주 왕숙2 공공주택지구</a><small>LH 토지이용계획 및 시설 자료</small></p><p><a href="https://www.nyj.go.kr/www/contents.do?key=4838" target="_blank" rel="noopener">지금·도농 정비사업</a><small>남양주시 관련 공고 확인</small></p></article>';
}
async function choose(x,listing=false) {
  selected=x;
  const token=++selection;
  drawRows();drawMap();drawLocation();
  locateVisible();
  const selectedType=x.type||type;
  $('latest').innerHTML='<strong>'+types[selectedType]+' 최근 실거래</strong><p class="muted">불러오는 중…</p>';
  if(listing)$('maptitle').scrollIntoView({block:'start',behavior:'smooth'});
  try {
    const params=new URLSearchParams({type:selectedType,start:day(today,-182),end:today});
    if(x.id)params.set('id',x.id);
    const result=await json('/api/trades?'+params);
    if(token!==selection)return;
    const rows=result.rows.filter(r=>x.id||norm(r.name)===norm(x.name)).slice(0,5);
    $('latest').innerHTML='<strong>'+types[selectedType]+' 최근 실거래</strong>'+ (rows.length?rows.map(r=>'<p>'+esc(r.date)+' · '+r.area+'㎡ · '+esc(r.floor)+'층 <b>'+esc(price(r))+'</b></p>').join(''):'<p class="muted">최근 6개월에 일치하는 단지 거래가 없습니다.</p>');
  }catch(e){if(token===selection)$('latest').textContent=e.message}
}
function drawListings(){
  $('listings').innerHTML=[...samples,...saved].map((x,i)=>'<article class="mini"><span class="tag">'+esc(types[x.type])+' · '+(i<samples.length?'예시':'등록')+'</span><div><button class="name" data-listing="'+i+'">'+esc(x.name)+'</button></div><p><strong>'+esc(x.price)+'</strong></p><small>'+esc(x.memo)+'</small></article>').join('');
}
$('rank').addEventListener('click',e=>{const b=e.target.closest('[data-rank]');if(b)choose(top[b.dataset.rank])});
$('listings').addEventListener('click',e=>{const b=e.target.closest('[data-listing]');if(b)choose([...samples,...saved][b.dataset.listing],true)});
$('filters').addEventListener('submit',e=>{e.preventDefault();load()});
$('area').addEventListener('change',load);
$('reset').onclick=clearSelection;
$('print').onclick=()=>window.print();
$('add').onclick=()=>$('dialog').showModal();
$('cancel').onclick=()=>$('dialog').close();
$('newListing').addEventListener('submit',e=>{
  e.preventDefault();
  const x={name:$('newName').value.trim(),type:$('newType').value,price:$('newPrice').value.trim(),memo:$('newMemo').value.trim()};
  if(!x.name||!x.price)return;
  try {localStorage.setItem('deokja-listings',JSON.stringify([...saved,x]))}
  catch {alert('브라우저 저장 공간을 사용할 수 없습니다.');return}
  saved.push(x);drawListings();e.target.reset();$('dialog').close();
});
document.querySelectorAll('[data-span]').forEach(b=>b.onclick=()=>{dates(b.dataset.span);load()});
document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type;buttonGroup('[data-type]',type,'type');load()});
for(const id of ['start','end']){$(id).max=today;$(id).onchange=()=>buttonGroup('[data-span]','','span')}
window.addEventListener('DOMContentLoaded',()=>{
  if(window.L){
    map=L.map('map').setView([37.605,127.163],13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
    layer=L.layerGroup().addTo(map);
  }else $('map').textContent='지도 모듈을 불러오지 못했습니다.';
  json('/api/places').then(v=>{points=v;placeState=''}).catch(()=>{placeState='서비스 연결 지연'}).finally(()=>{drawMap();drawLocation();locateVisible()});
});
json('/api/index').then(x=>{$('reb').textContent=n(x.value);$('rebnote').textContent=x.period+' · 한국부동산원'}).catch(e=>{$('rebnote').textContent=e.message});
drawListings();dates('month');buttonGroup('[data-type]',type,'type');load();
