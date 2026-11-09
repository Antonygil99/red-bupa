import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { inArea, normalize } from '../src/lib/directory.mjs';

const ROOT = new URL('../', import.meta.url);
export const SOURCE = 'https://www.bupasalud.com.mx/salud.php';
const DAYS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];
const GROUPS = [
 ['pediatria','Pediatría'],['medicina-general','Medicina general'],['hospital','Hospitales'],
 ['laboratorio','Laboratorios'],['farmacia','Farmacias'],['especialistas','Especialistas'],['servicios','Otros servicios'],
];
export function categoryFor(value) {
 const s=normalize(value);
 if(s==='pediatria')return 'pediatria';
 if(s==='medicina general o familiar')return 'medicina-general';
 if(s==='hospital')return 'hospital';
 if(/laboratorio|gabinete/.test(s))return 'laboratorio';
 if(s.includes('farmacia'))return 'farmacia';
 if(/ambulancia|protesis|rehabilitacion/.test(s))return 'servicios';
 return 'especialistas';
}
export const recordKey = p => `${p.idProveedor}|${normalize(p.nombre)}|${normalize(p.direccion)}|${normalize(p.especialidad)}`;
export function buildDirectory(rows, previous, overrides={}, timestamp=new Date().toISOString()) {
 if(!Array.isArray(rows)||!rows.length)throw new Error('El directorio llegó vacío. Se conserva la última versión.');
 const seen=new Set();
 const providers=rows.map(p=>{
  if(!p.idProveedor||!p.nombre||!p.direccion||!p.especialidad||normalize(p.municipio||'')!=='merida'||normalize(p.estado||'')!=='yucatan')throw new Error('Registro inválido o fuera del municipio solicitado.');
  const key=recordKey(p);
  if(seen.has(key))throw new Error(`Registro repetido: ${p.nombre}`);
  seen.add(key);
  const id=`${p.idProveedor}-${createHash('sha256').update(key).digest('hex').slice(0,12)}`;
  const raw={lat:Number(p.latitud),lng:Number(p.longitud)};
  const override=overrides[p.idProveedor];
  // Una corrección deja de aplicarse si Bupa cambia la dirección: necesita nueva revisión.
  const review=override&&normalize(override.originalAddress)===normalize(p.direccion)?override:null;
  const valid=Number.isFinite(raw.lat)&&Number.isFinite(raw.lng)&&inArea(raw.lat,raw.lng);
  const corrected=review?.coordinates&&inArea(review.coordinates.lat,review.coordinates.lng);
  const coordinates=review?.conflict?null:corrected?review.coordinates:valid?raw:null;
  return {
   id,sourceId:String(p.idProveedor),category:categoryFor(p.especialidad),
   name:String(p.nombre).trim(),neighborhood:p.colonia||'',address:p.direccion,postalCode:p.cp||'',
   municipality:p.municipio,specialty:p.especialidad,phone:p.telefonO1||'',secondaryPhone:p.telefonO2||null,price:p.costo||null,
   coordinates,originalCoordinates:raw,
   coordinateIssue:review?.conflict?review.note:coordinates?null:'La coordenada de Bupa está fuera de la zona de Mérida o no es válida.',
   locationStatus:review?.conflict?'conflict':corrected?'reviewed':coordinates?'source':'invalid',
   locationReview:review||null,
   photo:existsSync(new URL(`public/fotos/${p.idProveedor}.png`,ROOT))?`/fotos/${p.idProveedor}.png`:null,
   schedule:DAYS.map(day=>p['horariO_'+day]||null),
   active:p.activo===true,bookingEnabled:false,virtualEnabled:p.elegibleVirtual===true,
  };
 });
 // Distintas sucursales de una cadena no deben compartir ciegamente el mismo punto.
 const branches=new Map();
 for(const p of providers){
  if(p.category!=='farmacia'||!p.coordinates)continue;
  const key=`${p.sourceId}:${p.coordinates.lat.toFixed(5)},${p.coordinates.lng.toFixed(5)}`;
  branches.set(key,[...(branches.get(key)||[]),p]);
 }
 for(const group of branches.values()){
  if(new Set(group.map(p=>normalize(p.name))).size<2)continue;
  for(const p of group){p.coordinates=null;p.locationStatus='conflict';p.coordinateIssue='Bupa publica el mismo punto para sucursales con nombres y direcciones diferentes. Confirma la ubicación de esta sucursal.';}
 }
 const nowIds=new Set(providers.map(p=>p.id));
 const oldIds=new Set(previous.providers?.map(p=>p.id)||[]);
 return {...previous,sourceUrl:SOURCE,updatedAt:timestamp,syncFrequency:'monthly',
  categories:GROUPS.map(([id,label])=>({id,label,count:providers.filter(p=>p.category===id).length})).filter(c=>c.count),
  specialties:[...new Set(providers.map(p=>p.specialty))].sort((a,b)=>a.localeCompare(b,'es')),
  providers,
  syncSummary:{total:providers.length,added:providers.filter(p=>!oldIds.has(p.id)).length,removed:[...oldIds].filter(id=>!nowIds.has(id)).length,flagged:providers.filter(p=>!p.coordinates).length},
 };
}
export async function queryBupa(accion,extra={},fetcher=fetch) {
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetcher('https://www.bupasalud.com.mx/salud_api.php',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({accion,estado:'Yucatán',municipio:'Mérida',token:'false',...extra}),signal:AbortSignal.timeout(30000),
   });
   if(!response.ok)throw new Error(`Bupa respondió ${response.status}`);
   const result=await response.json();
   if(!Array.isArray(result))throw new Error('Respuesta de Bupa inesperada');
   return result;
  }catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
 }
}
export async function syncDirectory(){
 const previous=JSON.parse(await readFile(new URL('src/data/directory.json',ROOT),'utf8'));
 const overrides=JSON.parse(await readFile(new URL('src/data/location-reviews.json',ROOT),'utf8'));
 const specialties=await queryBupa('especialidades');
 if(!specialties.length)throw new Error('Catálogo de especialidades vacío');
 if(previous.specialties?.length>10&&specialties.length<previous.specialties.length*.8)throw new Error('Catálogo incompleto: se conserva la última versión.');
 const rows=[];
 for(const specialty of specialties){
  const name=specialty.IdEspecialidadProveedor;
  const batch=await queryBupa('directorio',{especialidad:name});
  if(!batch.length)throw new Error(`Sin resultados para ${name}: se conserva la versión anterior.`);
  rows.push(...batch);
  console.log(`${name}: ${batch.length}`);
 }
 if(previous.providers?.length&&rows.length<previous.providers.length*.8)throw new Error('Caída mayor al 20%: requiere revisión manual antes de sustituir los datos.');
 const data=buildDirectory(rows,previous,overrides);
 const text=JSON.stringify(data,null,2)+'\n';
 const path=new URL('src/data/directory.json',ROOT);
 // Ningún archivo cambia hasta que todas las especialidades terminaron correctamente.
 await writeFile(new URL('src/data/directory.next.json',ROOT),text);
 await rename(new URL('src/data/directory.next.json',ROOT),path);
 await mkdir(new URL('public/data/',ROOT),{recursive:true});
 await writeFile(new URL('public/data/directory.json',ROOT),text);
 console.log(`Sincronización completa: ${rows.length} registros, ${data.specialties.length} especialidades; ${data.syncSummary.flagged} ubicaciones pendientes.`);
 return data;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await syncDirectory();
