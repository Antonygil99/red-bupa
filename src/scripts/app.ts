import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { gsap } from 'gsap';
import directory from '../data/directory.json';
import { AREA, CENTER, distance, inArea, normalize, scheduledNow } from '../lib/directory.mjs';

type Provider = typeof directory.providers[number];
// Gestor de mapas y rutas configurado en .env (ver .env.example).
const MAPBOX_TOKEN = (import.meta.env.PUBLIC_MAPBOX_TOKEN ?? '').trim();
const MAPBOX_STYLE = (import.meta.env.PUBLIC_MAPBOX_STYLE || 'mapbox/light-v11').trim();
const ROUTING_PROFILE = (import.meta.env.PUBLIC_ROUTING_PROFILE || 'driving').trim();
const PROFILE_LABEL: Record<string,string> = {walking:'a pie',cycling:'en bici',driving:'en auto','driving-traffic':'en auto'};

const CATEGORIES = [{id:'all',label:'Toda la red',count:directory.providers.length}, ...directory.categories];
const RADIUS_STEPS: (number|'all')[] = [1,2,5,10,'all'];
const PREFS_KEY = 'myhealth:prefs';
const POSITION_KEY = 'myhealth:position';
const POSITION_TTL = 12*60*60*1000;

const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const icon = (name:string) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = (s:unknown) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const animate = (target:gsap.TweenTarget,vars:gsap.TweenVars) => { if(!reduced.matches)gsap.fromTo(target,{opacity:0,y:12},{opacity:1,y:0,duration:.4,ease:'power2.out',...vars}); };
// El almacenamiento puede estar bloqueado (modo privado); nunca debe romper la app.
const readStore = <T>(key:string):T|null => { try{ const raw=localStorage.getItem(key); return raw?JSON.parse(raw) as T:null; }catch{ return null; } };
const writeStore = (key:string,value:unknown) => { try{ localStorage.setItem(key,JSON.stringify(value)); }catch{} };

const saved = readStore<{category?:string;radius?:number;onlyScheduled?:boolean;collapsed?:boolean}>(PREFS_KEY) ?? {};
let query = '';
let category = CATEGORIES.some(c=>c.id===saved.category) ? saved.category! : 'all';
let radiusIndex = typeof saved.radius==='number' && saved.radius>=0 && saved.radius<RADIUS_STEPS.length ? saved.radius : RADIUS_STEPS.length-1;
let onlyScheduled = saved.onlyScheduled===true;
let collapsed = saved.collapsed===true;
let userPosition:[number,number]|null = null;
let selected:string|null = null;
let locating = false;
let map:L.Map|null=null, userMarker:L.Marker|null=null, rangeCircle:L.Circle|null=null;
let routeLayer:L.Polyline|null=null, routing=false;
let tileLayer:L.TileLayer|null=null;
const markers = new Map<string,L.Marker>();

const radius = () => RADIUS_STEPS[radiusIndex];
const radiusLabel = () => radius()==='all' ? 'Todo Mérida' : `A ${radius()} km de mí`;
const specialty = (p:Provider) => { const value=String(p.specialty??''); return /[a-záéíóúñ]/.test(value) ? value : value.toLocaleLowerCase('es').replace(/^./,c=>c.toLocaleUpperCase('es')); };
const initials = (p:Provider) => p.name.split(' ').filter(Boolean).slice(0,2).map(s=>s[0]).join('');
const avatar = (p:Provider) => `<span class="avatar cat-${escape(p.category)}">${p.photo?`<img src="${escape(p.photo)}" alt="" loading="lazy" decoding="async"/>`:escape(initials(p))}</span>`;
// El detalle tapa la esquina inferior izquierda del mapa: el encuadre lo esquiva.
function mapPadding(){
 const card=document.getElementById('detail');
 const panel=document.getElementById('map')!.getBoundingClientRect();
 if(!card||card.hidden)return {paddingTopLeft:[50,120] as [number,number],paddingBottomRight:[80,80] as [number,number]};
 const rect=card.getBoundingClientRect();
 if(matchMedia('(max-width:760px)').matches)return {paddingTopLeft:[30,150] as [number,number],paddingBottomRight:[30,Math.min(rect.height+40,panel.height*.6)] as [number,number]};
 return {paddingTopLeft:[Math.min(rect.right-panel.left+30,panel.width*.6),140] as [number,number],paddingBottomRight:[90,70] as [number,number]};
}
const km = (p:Provider) => userPosition&&p.coordinates ? distance(userPosition,[p.coordinates.lat,p.coordinates.lng]) : null;
const paintSlider = () => $('radius').style.setProperty('--fill',`${radiusIndex/(RADIUS_STEPS.length-1)*100}%`);
const savePrefs = () => writeStore(PREFS_KEY,{category,radius:radiusIndex,onlyScheduled,collapsed});

function toast(message:string){
 const el=document.createElement('div');el.className='toast';
 el.innerHTML=`${icon('info')}<span>${escape(message)}</span><button aria-label="Cerrar aviso">${icon('close')}</button>`;
 $('toasts').append(el);animate(el,{});
 const close=()=>{gsap.killTweensOf(el);el.remove();};el.querySelector('button')!.onclick=close;window.setTimeout(close,7000);
 while($('toasts').children.length>3)$('toasts').firstElementChild!.remove();
}
function matching(){
 return directory.providers.filter(p=>normalize(p.municipality)==='merida')
 .filter(p=>category==='all'||p.category===category)
 .filter(p=>normalize(`${p.name} ${p.neighborhood} ${p.specialty}`).includes(normalize(query)))
 .filter(p=>!onlyScheduled||scheduledNow(p.schedule))
 .filter(p=>radius()==='all'||(km(p)!==null&&km(p)!<=Number(radius())))
 .sort((a,b)=>userPosition?(km(a)??Infinity)-(km(b)??Infinity)||a.name.localeCompare(b.name,'es'):a.name.localeCompare(b.name,'es'));
}
function renderCategories(){
 $('categories').innerHTML=CATEGORIES.map(c=>`<button class="filter-chip category-chip cat-${escape(c.id)}" data-category="${escape(c.id)}" aria-pressed="${category===c.id}">${icon(c.id==='all'?'category':c.id)}${escape(c.label)}<em>${c.count}</em></button>`).join('');
 $('categories').querySelectorAll<HTMLButtonElement>('[data-category]').forEach(btn=>btn.onclick=()=>{
  category=btn.dataset.category!;savePrefs();closeDetail();renderCategories();render();updateBounds();
 });
}
function render(){
 const providers=matching();
 $('result-count').textContent=`${providers.length} ${providers.length===1?'proveedor':'proveedores'} ${userPosition?'en tu búsqueda':'en Mérida'}`;
 $('sort-label').textContent=userPosition?'Por cercanía':'A–Z';
 $('results').innerHTML=providers.length?providers.map(p=>`<button class="provider" data-id="${escape(p.id)}" aria-pressed="${selected===p.id}" aria-label="Ver perfil de ${escape(p.name)}">${avatar(p)}<span class="provider-copy"><span class="provider-name">${escape(p.name)}</span><span class="provider-place">${escape(p.neighborhood)}</span><span class="provider-status">${!p.coordinates?'Ubicación por verificar':escape(specialty(p))}</span></span><span class="provider-distance">${km(p)!==null?km(p)!.toFixed(1)+' km':icon('arrow')}</span></button>`).join(''):`<div class="empty-state">${radius()!=='all'?'No encontramos proveedores dentro de esta distancia.':'No encontramos proveedores con estos filtros.'}<br/>Prueba otra colonia, otra categoría o amplía la distancia.<br/><button id="reset-filters">Restablecer filtros</button></div>`;
 $('results').querySelectorAll<HTMLButtonElement>('[data-id]').forEach(btn=>btn.onclick=()=>selectProvider(btn.dataset.id!));
 if(document.getElementById('reset-filters'))$('reset-filters').onclick=()=>{
  query='';category='all';radiusIndex=RADIUS_STEPS.length-1;onlyScheduled=false;
  $<HTMLInputElement>('search').value='';$<HTMLInputElement>('radius').value=String(radiusIndex);
  $('radius-value').textContent=radiusLabel();paintSlider();$('schedule-filter').setAttribute('aria-pressed','false');
  savePrefs();renderCategories();render();updateBounds();
 };
 if(selected&&!providers.some(p=>p.id===selected))closeDetail();
 updateMarkers(providers);
 const located=providers.filter(p=>p.coordinates);
 $('map-count').textContent=`${located.length} ${located.length===1?'ubicación':'ubicaciones'} en el mapa`;
 const present=CATEGORIES.filter(c=>c.id!=='all'&&located.some(p=>p.category===c.id));
 $('map-legend').innerHTML=present.map(c=>`<span class="legend-item"><span class="legend-dot cat-${escape(c.id)}"></span>${escape(c.label)}</span>`).join('')||'<span class="legend-item">Sin ubicaciones visibles</span>';
}
function setView(showMap:boolean){
 $('app-shell').classList.toggle('map-view',showMap);
 $('show-list').setAttribute('aria-pressed',String(!showMap));$('show-map').setAttribute('aria-pressed',String(showMap));
 if(showMap)requestAnimationFrame(()=>{map?.invalidateSize();if(selected){const p=directory.providers.find(p=>p.id===selected);if(p?.coordinates)map?.panTo([p.coordinates.lat,p.coordinates.lng],{animate:!reduced.matches});}});
}
function setCollapsed(value:boolean){
 collapsed=value;savePrefs();
 $('app-shell').classList.toggle('collapsed',collapsed);
 const toggle=$('collapse-sidebar');
 toggle.setAttribute('aria-expanded',String(!collapsed));
 toggle.setAttribute('aria-label',collapsed?'Expandir panel':'Contraer panel');
 toggle.innerHTML=icon(collapsed?'expand':'collapse');
 document.querySelector('.rail')!.setAttribute('aria-hidden',String(!collapsed));
 requestAnimationFrame(()=>map?.invalidateSize());
}
function updateMarkers(providers:Provider[]){
 if(!map)return;
 markers.forEach(m=>m.remove());markers.clear();
 providers.forEach(p=>{if(!p.coordinates)return;
 const marker=L.marker([p.coordinates.lat,p.coordinates.lng],{icon:L.divIcon({className:`clinic-marker cat-${p.category}${selected===p.id?' selected':''}`,html:`<span class="pin-bubble">${icon(p.category)}</span>`,iconSize:[40,40],iconAnchor:[20,40]}),title:p.name,alt:`${specialty(p)}: ${p.name}`,keyboard:true,zIndexOffset:selected===p.id?1000:0});
 const tip=document.createElement('span');tip.textContent=p.name;
 marker.bindTooltip(tip,{direction:'top',offset:[0,-38]}).on('click',()=>selectProvider(p.id)).addTo(map!);markers.set(p.id,marker);
 });
}
function clearRoute(){routeLayer?.remove();routeLayer=null;}
function closeDetail(){clearRoute();selected=null;$('detail').hidden=true;document.querySelectorAll('.provider[aria-pressed=true]').forEach(el=>el.setAttribute('aria-pressed','false'));markers.forEach(m=>m.getElement()?.classList.remove('selected'));}
function selectProvider(id:string){
 const p=directory.providers.find(p=>p.id===id);if(!p)return;
 selected=id;$('location-prompt').hidden=true;
 const days=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
 const phone=String(p.phone||'').replace(/\D/g,'');
 const note=p.active
  ? 'Perfil activo en la red. Confirma horario y costo por teléfono; no hay agenda en línea.'
  : 'Actividad pendiente de confirmar. Llama para verificar atención, horario y costo. No hay agenda en línea.';
 $('detail').innerHTML=`<button class="detail-close icon-button" id="close-detail" aria-label="Cerrar perfil">${icon('close')}</button><div class="detail-top">${avatar(p)}<div><h2>${escape(p.name)}</h2><p>${escape(specialty(p))} · ${escape(p.neighborhood)}</p></div></div><div class="detail-section">${icon('pin')}<div><p>${escape(p.address)}</p><small>${escape(p.neighborhood)} · C.P. ${escape(p.postalCode)} · Mérida${km(p)!==null?`<br/>A ${km(p)!.toFixed(1)} km de ti · En línea recta`:''}</small>${!p.coordinates?'<p><strong>Ubicación por verificar</strong></p><small>La coordenada del directorio no corresponde a Mérida. Confirma la dirección antes de ir.</small>':''}</div></div><div class="detail-section">${icon('clock')}<div><strong>Horarios del directorio</strong><table class="hours" aria-label="Horario semanal"><tbody>${days.map((day,i)=>`<tr><td>${day}</td><td>${escape(p.schedule[i]||'Sin horario registrado')}</td></tr>`).join('')}</tbody></table></div></div><div class="detail-note">${escape(note)}</div><div class="detail-actions">${phone?`<a class="primary-button" href="tel:+52${escape(phone)}">${icon('phone')}Llamar ${escape(phone.replace(/(\d{3})(\d{3})(\d{4})/,'$1 $2 $3'))}</a>`:''}${p.coordinates?`<button class="secondary-button" id="route-button">${icon('route')}Cómo llegar</button>`:''}</div><p class="route-summary" id="route-summary" role="status" aria-live="polite" hidden></p>`;
 $('detail').hidden=false;clearRoute();
 if(document.getElementById('route-button'))$('route-button').onclick=()=>{drawRoute(p);};
 $('close-detail').onclick=()=>{closeDetail();render();const trigger=$('results').querySelector<HTMLButtonElement>(`[data-id="${id}"]`);if(matchMedia('(max-width:760px)').matches){setView(false);$('show-list').focus();}else trigger?.focus();};
 render();setView(true);
 if(p.coordinates)requestAnimationFrame(()=>map?.panInside([p.coordinates!.lat,p.coordinates!.lng],{...mapPadding(),animate:!reduced.matches}));
 animate($('detail'),{});$('close-detail').focus({preventScroll:true});
}
async function drawRoute(p:Provider){
 const summary=$('route-summary');
 if(!map||!p.coordinates){toast('No podemos trazar la ruta: este perfil no tiene una ubicación verificada.');return;}
 if(!userPosition){toast('Activa tu ubicación para trazar la ruta hasta el proveedor.');locate();return;}
 const target:[number,number]=[p.coordinates.lat,p.coordinates.lng];
 const show=(latlngs:[number,number][],dashed:boolean)=>{
  clearRoute();
  routeLayer=L.polyline(latlngs,{className:'route-line',color:'#4d8dee',weight:dashed?3:5,opacity:.95,lineCap:'round',lineJoin:'round',dashArray:dashed?'6 8':undefined,interactive:false}).addTo(map!);
  map!.setMaxBounds(L.latLngBounds(AREA as L.LatLngBoundsLiteral));
  map!.fitBounds(routeLayer.getBounds(),{...mapPadding(),maxZoom:16,animate:!reduced.matches});
  setView(true);
 };
 if(!MAPBOX_TOKEN){
  show([userPosition,target],true);
  summary.hidden=false;summary.textContent='Falta configurar PUBLIC_MAPBOX_TOKEN en .env para calcular rutas. Mientras tanto mostramos la línea recta, no un trayecto real.';
  return;
 }
 if(routing)return;
 routing=true;
 $<HTMLButtonElement>('route-button').disabled=true;
 summary.hidden=false;summary.textContent='Calculando la ruta…';
 try{
  const url=`https://api.mapbox.com/directions/v5/mapbox/${encodeURIComponent(ROUTING_PROFILE)}/${userPosition[1]},${userPosition[0]};${target[1]},${target[0]}?geometries=geojson&overview=full&language=es&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
  const response=await fetch(url);
  if(!response.ok)throw new Error(String(response.status));
  const route=(await response.json())?.routes?.[0];
  const line=route?.geometry?.coordinates as [number,number][]|undefined;
  if(!line?.length)throw new Error('sin ruta');
  show(line.map(([lng,lat])=>[lat,lng] as [number,number]),false);
  summary.textContent=`Ruta de ${(route.distance/1000).toFixed(1)} km · ${Math.round(route.duration/60)} min aprox. ${PROFILE_LABEL[ROUTING_PROFILE]??''} · Trayecto sugerido, verifica el camino y la atención antes de salir.`;
 }catch{
  show([userPosition,target],true);
  summary.textContent='No pudimos calcular la ruta. Mostramos la línea recta; inténtalo de nuevo más tarde.';
  toast('El servicio de rutas no respondió. Puedes reintentar «Cómo llegar».');
 }finally{
  routing=false;
  const button=document.getElementById('route-button') as HTMLButtonElement|null;
  if(button)button.disabled=false;
 }
}
function updateBounds(){
 if(!map)return;
 if(rangeCircle){rangeCircle.remove();rangeCircle=null;}
 const area=L.latLngBounds(AREA as L.LatLngBoundsLiteral);
 if(userPosition&&radius()!=='all'){
  rangeCircle=L.circle(userPosition,{radius:Number(radius())*1000,color:'#4d8dee',weight:1.5,dashArray:'5 7',fillColor:'#4d8dee',fillOpacity:.07,interactive:false}).addTo(map);
  const b=rangeCircle.getBounds();
  const clipped=L.latLngBounds([Math.max(area.getSouth(),b.getSouth()),Math.max(area.getWest(),b.getWest())],[Math.min(area.getNorth(),b.getNorth()),Math.min(area.getEast(),b.getEast())]);
  map.setMaxBounds(clipped.pad(.12));
  if(reduced.matches)map.fitBounds(clipped,{padding:[30,30],animate:false});else map.flyToBounds(clipped,{padding:[30,30],duration:1.1});
 }else{map.setMaxBounds(area);if(userPosition)map.flyTo(userPosition,13,{animate:!reduced.matches,duration:1.1});}
}
function applyPosition(position:[number,number]){
 userPosition=position;
 writeStore(POSITION_KEY,{lat:position[0],lng:position[1],ts:Date.now()});
 $('location-label').textContent='Tu ubicación · Mérida';
 $('radius-help').textContent='Distancias en línea recta desde tu ubicación.';
 $('location-prompt').hidden=true;
 userMarker?.remove();
 if(map)userMarker=L.marker(position,{icon:L.divIcon({className:'user-marker'+(reduced.matches?'':' pulsing'),html:'<span class="user-wave"></span><span class="user-wave user-wave-late"></span><span class="user-dot"></span>',iconSize:[22,22],iconAnchor:[11,11]}),interactive:false,keyboard:false,zIndexOffset:500}).addTo(map);
}
function storedPosition():[number,number]|null{
 const value=readStore<{lat:number;lng:number;ts:number}>(POSITION_KEY);
 if(!value||typeof value.lat!=='number'||typeof value.lng!=='number')return null;
 if(Date.now()-value.ts>POSITION_TTL||!inArea(value.lat,value.lng))return null;
 return [value.lat,value.lng];
}
function locate({silent=false}={}){
 if(locating)return;
 if(!window.isSecureContext){if(!silent)toast('Tu navegador necesita una conexión segura (HTTPS) para compartir tu ubicación. Puedes explorar Mérida.');return;}
 if(!navigator.geolocation){if(!silent)toast('Este navegador no permite obtener tu ubicación. Puedes explorar Mérida.');return;}
 locating=true;
 const button=$<HTMLButtonElement>('enable-location');
 if(!silent){
  button.disabled=true;button.innerHTML=`Buscando tu ubicación…${icon('locate')}`;
  ['sidebar-locate','map-locate'].forEach(id=>$<HTMLButtonElement>(id).disabled=true);
  if(!reduced.matches)gsap.to('#enable-location svg',{rotation:360,repeat:-1,duration:2,ease:'none'});
 }
 const finish=()=>{
  locating=false;
  if(silent)return;
  button.disabled=false;gsap.killTweensOf('#enable-location svg');button.innerHTML=`Usar mi ubicación${icon('arrow')}`;
  ['sidebar-locate','map-locate'].forEach(id=>$<HTMLButtonElement>(id).disabled=false);
 };
 navigator.geolocation.getCurrentPosition(position=>{
  finish();const {latitude,longitude,accuracy}=position.coords;
  if(!inArea(latitude,longitude)){if(!silent){toast('Tu ubicación está fuera de la zona de Mérida. Por ahora, solo tenemos proveedores de este municipio.');$('location-prompt').hidden=true;setView(true);}return;}
  applyPosition([latitude,longitude]);
  closeDetail();render();updateBounds();
  if(!silent){setView(true);toast(accuracy>500?'Ubicación aproximada. Las distancias pueden variar.':`Ubicación lista. Ordenamos la red por cercanía (${radiusLabel().toLowerCase()}).`);}
 },error=>{
  finish();
  if(silent)return;
  const messages:Record<number,string>={1:'No se permitió la ubicación. Puedes activarla en los permisos de tu navegador o explorar Mérida.',2:'No pudimos obtener tu ubicación. Revisa el GPS e inténtalo de nuevo.',3:'La ubicación tardó demasiado. Inténtalo de nuevo o explora Mérida.'};
  toast(messages[error.code]||'No pudimos obtener tu ubicación. Puedes explorar Mérida.');
 },{enableHighAccuracy:!silent,timeout:12000,maximumAge:silent?POSITION_TTL:600000});
}
function initMap(){
 try{
  map=L.map('map',{zoomControl:false,attributionControl:true,minZoom:11,maxZoom:18,maxBounds:AREA as L.LatLngBoundsLiteral,maxBoundsViscosity:1}).setView(CENTER as [number,number],13);
  tileLayer=MAPBOX_TOKEN
   ? L.tileLayer(`https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`,{attribution:'&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',tileSize:512,zoomOffset:-1,maxZoom:19})
   : L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',subdomains:'abcd',maxZoom:19});
  let successes=0,errors=0;
  tileLayer.on('tileload',()=>{successes++;if(successes>errors)$('map-message').hidden=true;});
  tileLayer.on('tileerror',()=>{errors++;if(errors>=3)$('map-message').hidden=false;});
  tileLayer.addTo(map);
  const located=directory.providers.filter(p=>p.coordinates);
  if(located.length)map.fitBounds(L.latLngBounds(located.map(p=>[p.coordinates!.lat,p.coordinates!.lng] as [number,number])),{paddingTopLeft:[55,115],paddingBottomRight:[75,100],maxZoom:13,animate:false});
  $('retry-map').onclick=()=>{successes=0;errors=0;$('map-message').hidden=true;tileLayer?.redraw();};
 }catch{ $('map-message').hidden=false;$('retry-map').onclick=()=>window.location.reload();toast('El mapa no pudo iniciarse. El directorio sigue disponible.'); }
}

$<HTMLInputElement>('search').addEventListener('input',e=>{query=(e.target as HTMLInputElement).value;render();});
$('schedule-filter').onclick=()=>{onlyScheduled=!onlyScheduled;$('schedule-filter').setAttribute('aria-pressed',String(onlyScheduled));savePrefs();render();if(onlyScheduled)toast('Filtro basado en el horario de Mérida del directorio. Confirma la atención por teléfono.');};
$<HTMLInputElement>('radius').oninput=e=>{
 const next=Number((e.target as HTMLInputElement).value);
 if(RADIUS_STEPS[next]!=='all'&&!userPosition){
  $<HTMLInputElement>('radius').value=String(radiusIndex);
  toast('Activa tu ubicación para buscar por distancia.');locate();return;
 }
 radiusIndex=next;$('radius-value').textContent=radiusLabel();paintSlider();savePrefs();render();updateBounds();
};
['enable-location','sidebar-locate','map-locate'].forEach(id=>$(id).onclick=()=>{if(userPosition&&id==='map-locate'){updateBounds();setView(true);}else locate();});
$('explore').onclick=()=>{$('location-prompt').hidden=true;toast('Explora la red de Mérida. Selecciona un punto o un perfil.');};
$('collapse-sidebar').onclick=()=>setCollapsed(!collapsed);
document.querySelectorAll<HTMLButtonElement>('.rail [data-expand]').forEach(btn=>btn.onclick=()=>{
 setCollapsed(false);
 const target=$(btn.dataset.expand==='search'?'search':btn.dataset.expand==='radius'?'radius':'categories');
 requestAnimationFrame(()=>(target.querySelector('button')??target).focus());
});
$('zoom-in').onclick=()=>map?.zoomIn();$('zoom-out').onclick=()=>map?.zoomOut();
$('show-list').onclick=()=>setView(false);$('show-map').onclick=()=>setView(true);
const dialog=$<HTMLDialogElement>('help-dialog');$('help-button').onclick=()=>dialog.showModal();['close-help','got-it'].forEach(id=>$(id).onclick=()=>dialog.close());
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selected&&!dialog.open)$('close-detail')?.click();});
window.addEventListener('offline',()=>{toast('Sin conexión. Puedes consultar los perfiles; el mapa puede estar incompleto.');$('map-message').hidden=false;});
window.addEventListener('online',()=>{toast('Conexión recuperada.');tileLayer?.redraw();});

// Estado inicial desde las preferencias guardadas.
$<HTMLInputElement>('radius').value=String(radiusIndex);
$('radius-value').textContent=radiusLabel();
paintSlider();
$('schedule-filter').setAttribute('aria-pressed',String(onlyScheduled));
setCollapsed(collapsed);
initMap();
const remembered=storedPosition();
if(remembered)applyPosition(remembered);
renderCategories();render();
if(remembered)updateBounds();
// Si el permiso ya estaba concedido, se refresca sin volver a preguntar.
navigator.permissions?.query({name:'geolocation'}).then(status=>{if(status.state==='granted')locate({silent:true});}).catch(()=>{});

// La pantalla de carga sale hacia arriba en cuanto la app está lista.
let loaderGone=false;
function dismissLoader(){
 const loader=document.getElementById('loader');
 if(!loader||loaderGone)return;
 loaderGone=true;
 const remove=()=>loader.remove();
 if(reduced.matches){gsap.to(loader,{opacity:0,duration:.25,onComplete:remove});return;}
 gsap.timeline({onComplete:remove})
  .to('.loader-bar, .loader-text',{opacity:0,duration:.25,ease:'power1.out'})
  .to('.loader-logo',{y:-16,opacity:0,duration:.35,ease:'power2.in'},'-=.15')
  .to(loader,{yPercent:-100,duration:.75,ease:'power3.inOut'},'-=.1');
}
const pageReady=document.readyState==='complete'
 ? Promise.resolve()
 : new Promise<void>(resolve=>window.addEventListener('load',()=>resolve(),{once:true}));
Promise.all([pageReady,new Promise(resolve=>window.setTimeout(resolve,700))]).then(dismissLoader);
// Nunca se queda atascada aunque un recurso externo no cargue.
window.setTimeout(dismissLoader,6000);

gsap.matchMedia().add('(prefers-reduced-motion: no-preference)',()=>{gsap.fromTo('.brand-row, .location-box, .controls, .search-overlay',{opacity:0,y:14},{opacity:1,y:0,stagger:.06,duration:.6,ease:'power2.out'});animate('.location-prompt',{delay:.3});});
window.setInterval(()=>{if(onlyScheduled)render();},60000);

// Superficie WebMCP opcional, detectada por capacidades; usa el mismo estado que la interfaz.
const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>unknown}}).modelContext;
if(context?.registerTool){
 const lifecycle=new AbortController();
 const tools=[{
  name:'search_providers',title:'Buscar proveedores',description:'Filtra el directorio visible por nombre, colonia o servicio. Devuelve los perfiles coincidentes.',
  inputSchema:{type:'object',properties:{query:{type:'string'},category:{type:'string',enum:CATEGORIES.map(c=>c.id)}},required:['query'],additionalProperties:false},
  annotations:{readOnlyHint:false,untrustedContentHint:true},
  execute(input:unknown){const v=input as {query?:unknown;category?:unknown};if(!v||typeof v.query!=='string'||v.query.length>200)throw new Error('Se requiere query de hasta 200 caracteres.');
   if(typeof v.category==='string'){if(!CATEGORIES.some(c=>c.id===v.category))throw new Error('Categoría desconocida.');category=v.category;}
   query=v.query;$<HTMLInputElement>('search').value=query;renderCategories();render();
   return matching().map(p=>({id:p.id,name:p.name,category:p.category,specialty:p.specialty,neighborhood:p.neighborhood,hasCoordinates:!!p.coordinates}));}
 },{
  name:'show_provider',title:'Abrir perfil',description:'Abre el perfil de un proveedor en la interfaz. No llama ni reserva citas.',
  inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},
  annotations:{readOnlyHint:false,untrustedContentHint:true},
  execute(input:unknown){const v=input as {id?:unknown};if(!v||typeof v.id!=='string')throw new Error('Se requiere id.');const p=matching().find(p=>p.id===v.id);if(!p)throw new Error('El perfil no existe en los resultados actuales.');selectProvider(p.id);return {id:p.id,name:p.name,phone:p.phone,address:p.address,bookingEnabled:p.bookingEnabled};}
 }];
 for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
