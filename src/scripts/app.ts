import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { gsap } from 'gsap';
import directory from '../data/directory.json';
import { AREA, CENTER, distance, inArea, normalize, scheduledNow } from '../lib/directory.mjs';

type Provider = typeof directory.providers[number];
const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const icon = (name:string) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = (s:unknown) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const animate = (target:gsap.TweenTarget,vars:gsap.TweenVars) => { if(!reduced.matches)gsap.fromTo(target,{opacity:0,y:12},{opacity:1,y:0,duration:.4,ease:'power2.out',...vars}); };
let userPosition:[number,number]|null=null;
let selected:string|null=null;
let query='', radius='all',onlyScheduled=false, locating=false;
let map:L.Map|null=null, userMarker:L.CircleMarker|null=null, rangeCircle:L.Circle|null=null;
let tileLayer:L.TileLayer|null=null;
const markers = new Map<string,L.Marker>();
const initials=(p:Provider)=>p.name.split(' ').slice(0,2).map(s=>s[0]).join('');
const km=(p:Provider)=>userPosition&&p.coordinates?distance(userPosition,[p.coordinates.lat,p.coordinates.lng]):null;

function toast(message:string){
 const el=document.createElement('div');el.className='toast';
 el.innerHTML=`${icon('info')}<span>${escape(message)}</span><button aria-label="Cerrar aviso">${icon('close')}</button>`;
 $('toasts').append(el);animate(el,{});
 const close=()=>{gsap.killTweensOf(el);el.remove();};el.querySelector('button')!.onclick=close;window.setTimeout(close,7000);
 while($('toasts').children.length>3)$('toasts').firstElementChild!.remove();
}
function matching(){
 return directory.providers.filter(p=>normalize(p.municipality)==='merida'&&normalize(p.specialty)==='pediatria')
 .filter(p=>normalize(p.name+' '+p.neighborhood).includes(normalize(query)))
 .filter(p=>!onlyScheduled||scheduledNow(p.schedule))
 .filter(p=>radius==='all'||(km(p)!==null&&km(p)!<=Number(radius)))
 .sort((a,b)=>userPosition?(km(a)??Infinity)-(km(b)??Infinity)||a.name.localeCompare(b.name,'es'):a.name.localeCompare(b.name,'es'));
}
function render(){
 const providers=matching();
 $('result-count').textContent=`${providers.length} ${providers.length===1?'pediatra':'pediatras'} ${userPosition?'en tu búsqueda':'en Mérida'}`;
 $('sort-label').textContent=userPosition?'Por cercanía':'A–Z';
 $('results').innerHTML=providers.length?providers.map(p=>`<button class="provider" data-id="${escape(p.id)}" aria-pressed="${selected===p.id}" aria-label="Ver perfil de ${escape(p.name)}"><span class="avatar">${escape(initials(p))}</span><span class="provider-copy"><span class="provider-name">${escape(p.name)}</span><span class="provider-place">${escape(p.neighborhood)}</span><span class="provider-status">${!p.coordinates?'Ubicación por verificar':onlyScheduled?'En horario del directorio':'Pediatría · Consulta presencial'}</span></span><span class="provider-distance">${km(p)!==null?km(p)!.toFixed(1)+' km':icon('arrow')}</span></button>`).join(''):`<div class="empty-state">${radius!=='all'?'No encontramos pediatras dentro de esta distancia.':'No encontramos pediatras con estos filtros.'}<br/>Prueba otra colonia o amplía tu búsqueda.<br/><button id="reset-filters">Restablecer filtros</button></div>`;
 $('results').querySelectorAll<HTMLButtonElement>('[data-id]').forEach(btn=>btn.onclick=()=>selectProvider(btn.dataset.id!));
 if($('reset-filters'))$('reset-filters').onclick=()=>{query='';radius='all';onlyScheduled=false;$<HTMLInputElement>('search').value='';$<HTMLSelectElement>('radius').value='all';$('schedule-filter').setAttribute('aria-pressed','false');render();updateBounds();};
 if(selected&&!providers.some(p=>p.id===selected))closeDetail();
 updateMarkers(providers);
 const located=providers.filter(p=>p.coordinates).length;
 $('map-count').textContent=`${located} ${located===1?'ubicación':'ubicaciones'} en el mapa`;
}
function setView(showMap:boolean){
 document.querySelector('.app-shell')!.classList.toggle('map-view',showMap);
 $('show-list').setAttribute('aria-pressed',String(!showMap));$('show-map').setAttribute('aria-pressed',String(showMap));
 if(showMap)requestAnimationFrame(()=>{map?.invalidateSize();if(selected){const p=directory.providers.find(p=>p.id===selected);if(p?.coordinates)map?.panTo([p.coordinates.lat,p.coordinates.lng],{animate:!reduced.matches});}});
}
function updateMarkers(providers:Provider[]){
 if(!map)return;
 markers.forEach(m=>m.remove());markers.clear();
 providers.forEach(p=>{if(!p.coordinates)return;
 const marker=L.marker([p.coordinates.lat,p.coordinates.lng],{icon:L.divIcon({className:'clinic-marker'+(selected===p.id?' selected':''),html:`<span class="pin-bubble">${icon('cross')}</span>`,iconSize:[40,40],iconAnchor:[20,40]}),title:p.name,alt:`Consultorio de ${p.name}`,keyboard:true,zIndexOffset:selected===p.id?1000:0});
 const tip=document.createElement('span');tip.textContent=p.name;
 marker.bindTooltip(tip,{direction:'top',offset:[0,-38]}).on('click',()=>selectProvider(p.id)).addTo(map!);markers.set(p.id,marker);
 });
}
function closeDetail(){selected=null;$('detail').hidden=true;document.querySelectorAll('.provider[aria-pressed=true]').forEach(el=>el.setAttribute('aria-pressed','false'));markers.forEach(m=>m.getElement()?.classList.remove('selected'));}
function selectProvider(id:string){
 const p=directory.providers.find(p=>p.id===id);if(!p)return;
 selected=id;$('location-prompt').hidden=true;
 const days=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
 const destination=p.coordinates?`${p.coordinates.lat},${p.coordinates.lng}`:`${p.address}, ${p.neighborhood}, Mérida, Yucatán, ${p.postalCode}`;
 const directions=new URL('https://www.google.com/maps/dir/');directions.searchParams.set('api','1');directions.searchParams.set('destination',destination);if(userPosition)directions.searchParams.set('origin',userPosition.join(','));
 $('detail').innerHTML=`<button class="detail-close icon-button" id="close-detail" aria-label="Cerrar perfil">${icon('close')}</button><div class="detail-top"><span class="avatar">${escape(initials(p))}</span><div><h2>${escape(p.name)}</h2><p>Pediatría · ${escape(p.neighborhood)}</p></div></div><div class="detail-section">${icon('pin')}<div><p>${escape(p.address)}</p><small>${escape(p.neighborhood)} · C.P. ${escape(p.postalCode)} · Mérida${km(p)!==null?`<br/>A ${km(p)!.toFixed(1)} km de ti · En línea recta`:''}</small>${!p.coordinates?'<p><strong>Ubicación por verificar</strong></p><small>La coordenada del directorio no corresponde a Mérida. Confirma la dirección antes de ir.</small>':''}</div></div><div class="detail-section">${icon('clock')}<div><strong>Horarios del directorio</strong><table class="hours" aria-label="Horario semanal"><tbody>${days.map((day,i)=>`<tr><td>${day}</td><td>${escape(p.schedule[i]||'Sin horario registrado')}</td></tr>`).join('')}</tbody></table></div></div><div class="detail-note">Actividad pendiente de confirmar. Llama para verificar atención, horario y costo. No hay agenda en línea.</div><div class="detail-actions"><a class="primary-button" href="tel:+52${escape(p.phone.replace(/\D/g,''))}">${icon('phone')}Llamar ${escape(p.phone.replace(/(\d{3})(\d{3})(\d{4})/,'$1 $2 $3'))}</a><a class="secondary-button" href="${escape(directions.toString())}" target="_blank" rel="noopener noreferrer">${p.coordinates?'Cómo llegar':'Buscar dirección'}${icon('arrow')}</a></div>`;
 $('detail').hidden=false;$('close-detail').onclick=()=>{closeDetail();render();const trigger=$('results').querySelector<HTMLButtonElement>(`[data-id="${id}"]`);if(matchMedia('(max-width:760px)').matches){setView(false);$('show-list').focus();}else trigger?.focus();};
 render();setView(true);if(p.coordinates)map?.panTo([p.coordinates.lat,p.coordinates.lng],{animate:!reduced.matches});
 animate($('detail'),{});$('close-detail').focus({preventScroll:true});
}
function updateBounds(){
 if(!map)return;
 if(rangeCircle){rangeCircle.remove();rangeCircle=null;}
 const area=L.latLngBounds(AREA as L.LatLngBoundsLiteral);
 if(userPosition&&radius!=='all'){
  rangeCircle=L.circle(userPosition,{radius:Number(radius)*1000,color:'#68904b',weight:1.5,dashArray:'5 7',fillColor:'#b7f279',fillOpacity:.09,interactive:false}).addTo(map);
  const b=rangeCircle.getBounds();
  const clipped=L.latLngBounds([Math.max(area.getSouth(),b.getSouth()),Math.max(area.getWest(),b.getWest())],[Math.min(area.getNorth(),b.getNorth()),Math.min(area.getEast(),b.getEast())]);
  map.setMaxBounds(clipped.pad(.12));map.fitBounds(clipped,{padding:[30,30],animate:!reduced.matches});
 }else{map.setMaxBounds(area);if(userPosition)map.setView(userPosition,13,{animate:!reduced.matches});}
}
function locate(){
 if(locating)return;
 if(!window.isSecureContext){toast('Tu navegador necesita una conexión segura (HTTPS) para compartir tu ubicación. Puedes explorar Mérida.');return;}
 if(!navigator.geolocation){toast('Este navegador no permite obtener tu ubicación. Puedes explorar Mérida.');return;}
 locating=true;
 const button=$<HTMLButtonElement>('enable-location');button.disabled=true;button.innerHTML=`Buscando tu ubicación…${icon('locate')}`;
 ['sidebar-locate','map-locate'].forEach(id=>$<HTMLButtonElement>(id).disabled=true);
 if(!reduced.matches)gsap.to('#enable-location svg',{rotation:360,repeat:-1,duration:2,ease:'none'});
 const finish=()=>{locating=false;button.disabled=false;gsap.killTweensOf('#enable-location svg');button.innerHTML=`Usar mi ubicación${icon('arrow')}`;['sidebar-locate','map-locate'].forEach(id=>$<HTMLButtonElement>(id).disabled=false);};
 navigator.geolocation.getCurrentPosition(position=>{
  finish();const {latitude,longitude,accuracy}=position.coords;
  if(!inArea(latitude,longitude)){toast('Tu ubicación está fuera de la zona de Mérida. Por ahora, solo tenemos pediatras de este municipio.');$('location-prompt').hidden=true;setView(true);return;}
  userPosition=[latitude,longitude];radius='5';$<HTMLSelectElement>('radius').value=radius;
  $('location-label').textContent='Tu ubicación · Mérida';$('radius-help').textContent='Distancias en línea recta desde tu ubicación.';$('location-prompt').hidden=true;
  userMarker?.remove();if(map)userMarker=L.circleMarker(userPosition,{radius:8,color:'#fff',weight:3,fillColor:'#4d8dee',fillOpacity:1}).bindTooltip('Tu ubicación').addTo(map);
  closeDetail();render();updateBounds();setView(true);toast(accuracy>500?'Ubicación aproximada. Las distancias pueden variar.':'Ubicación lista. Estos son los pediatras a 5 km de ti.');
 },error=>{finish();const messages:Record<number,string>={1:'No se permitió la ubicación. Puedes activarla en los permisos de tu navegador o explorar Mérida.',2:'No pudimos obtener tu ubicación. Revisa el GPS e inténtalo de nuevo.',3:'La ubicación tardó demasiado. Inténtalo de nuevo o explora Mérida.'};toast(messages[error.code]||'No pudimos obtener tu ubicación. Puedes explorar Mérida.');},{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}
function initMap(){
 try{
  map=L.map('map',{zoomControl:false,attributionControl:true,minZoom:11,maxZoom:18,maxBounds:AREA as L.LatLngBoundsLiteral,maxBoundsViscosity:1}).setView(CENTER as [number,number],13);
  tileLayer=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',subdomains:'abcd',maxZoom:19});
  let successes=0,errors=0;
  tileLayer.on('tileload',()=>{successes++;if(successes>errors)$('map-message').hidden=true;});
  tileLayer.on('tileerror',()=>{errors++;if(errors>=3)$('map-message').hidden=false;});
  tileLayer.addTo(map);render();
  map.fitBounds(L.latLngBounds(directory.providers.filter(p=>p.coordinates).map(p=>[p.coordinates!.lat,p.coordinates!.lng] as [number,number])),{paddingTopLeft:[55,115],paddingBottomRight:[75,100],maxZoom:13,animate:false});
  $('retry-map').onclick=()=>{successes=0;errors=0;$('map-message').hidden=true;tileLayer?.redraw();};
 }catch{ $('map-message').hidden=false;$('retry-map').onclick=()=>window.location.reload();toast('El mapa no pudo iniciarse. El directorio sigue disponible.'); }
}
$<HTMLInputElement>('search').addEventListener('input',e=>{query=(e.target as HTMLInputElement).value;render();});
$('schedule-filter').onclick=()=>{onlyScheduled=!onlyScheduled;$('schedule-filter').setAttribute('aria-pressed',String(onlyScheduled));render();if(onlyScheduled)toast('Filtro basado en el horario de Mérida del directorio. Confirma la atención por teléfono.');};
$<HTMLSelectElement>('radius').onchange=e=>{const value=(e.target as HTMLSelectElement).value;if(value!=='all'&&!userPosition){$<HTMLSelectElement>('radius').value=radius;toast('Activa tu ubicación para buscar por distancia.');locate();return;}radius=value;render();updateBounds();};
['enable-location','sidebar-locate','map-locate'].forEach(id=>$(id).onclick=()=>{if(userPosition&&id==='map-locate'){updateBounds();setView(true);}else locate();});
$('explore').onclick=()=>{$('location-prompt').hidden=true;toast('Explora los consultorios de Mérida. Selecciona un punto o un perfil.');};
$('zoom-in').onclick=()=>map?.zoomIn();$('zoom-out').onclick=()=>map?.zoomOut();
$('show-list').onclick=()=>setView(false);$('show-map').onclick=()=>setView(true);
const dialog=$<HTMLDialogElement>('help-dialog');$('help-button').onclick=()=>dialog.showModal();['close-help','got-it'].forEach(id=>$(id).onclick=()=>dialog.close());
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selected&&!dialog.open)$('close-detail')?.click();});
window.addEventListener('offline',()=>{toast('Sin conexión. Puedes consultar los perfiles; el mapa puede estar incompleto.');$('map-message').hidden=false;});
window.addEventListener('online',()=>{toast('Conexión recuperada.');tileLayer?.redraw();});
initMap();render();
gsap.matchMedia().add('(prefers-reduced-motion: no-preference)',()=>{gsap.fromTo('.brand-row, .intro, .location-box, .search-field, .filters',{opacity:0,y:14},{opacity:1,y:0,stagger:.06,duration:.6,ease:'power2.out'});animate('.location-prompt',{delay:.3});gsap.fromTo('.brand-icon svg',{rotation:-90,scale:.65},{rotation:0,scale:1,duration:.85,ease:'back.out(1.8)'});});
window.setInterval(()=>{if(onlyScheduled)render();},60000);

// Optional, capability-detected WebMCP surface; uses the same state as the UI.
const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>unknown}}).modelContext;
if(context?.registerTool){
 const lifecycle=new AbortController();
 const tools=[{
  name:'search_pediatricians',title:'Buscar pediatras',description:'Filtra el directorio visible por nombre o colonia. Devuelve los perfiles coincidentes.',
  inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},
  annotations:{readOnlyHint:false,untrustedContentHint:true},
  execute(input:unknown){const v=input as {query?:unknown};if(!v||typeof v.query!=='string'||v.query.length>200)throw new Error('Se requiere query de hasta 200 caracteres.');query=v.query;$<HTMLInputElement>('search').value=query;render();return matching().map(p=>({id:p.id,name:p.name,neighborhood:p.neighborhood,hasCoordinates:!!p.coordinates}));}
 },{
  name:'show_pediatrician',title:'Abrir perfil',description:'Abre el perfil de un pediatra en la interfaz. No llama ni reserva citas.',
  inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},
  annotations:{readOnlyHint:false,untrustedContentHint:true},
  execute(input:unknown){const v=input as {id?:unknown};if(!v||typeof v.id!=='string')throw new Error('Se requiere id.');const p=matching().find(p=>p.id===v.id);if(!p)throw new Error('El perfil no existe en los resultados actuales.');selectProvider(p.id);return {id:p.id,name:p.name,phone:p.phone,address:p.address,bookingEnabled:false};}
 }];
 for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
