import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectory,queryBupa} from '../scripts/sync-data.mjs';
const row={idProveedor:'chain',nombre:'Sucursal A',direccion:'Calle 1 200',colonia:'Centro',municipio:'Mérida',estado:'Yucatán',especialidad:'FARMACIAS EN GENERAL',latitud:'20.98',longitud:'-89.62',activo:false,elegibleAgenda:true};
test('branch identifiers survive upstream reordering and inserting branches',()=>{
 const b={...row,nombre:'Sucursal B',direccion:'Calle 2 300',longitud:'-89.63'};
 const first=buildDirectory([row,b],{});
 const second=buildDirectory([{...row,nombre:'Sucursal C',direccion:'Calle 3 400',longitud:'-89.64'},b,row],first);
 assert.equal(first.providers[0].id,second.providers[2].id);
 assert.equal(first.providers[1].id,second.providers[1].id);
 assert.equal(new Set(second.providers.map(p=>p.id)).size,3);
 assert.ok(second.providers.every(p=>!p.bookingEnabled));
});
test('stale location corrections do not apply to a new address',()=>{
 const overrides={chain:{originalAddress:'Otra calle',coordinates:{lat:21.01,lng:-89.6},sourceUrl:'https://example.com'}};
 const p=buildDirectory([row],{},overrides).providers[0];
 assert.deepEqual(p.coordinates,{lat:20.98,lng:-89.62});
 assert.equal(p.locationReview,null);
});
test('empty, duplicate or out-of-scope records fail before replacing files',()=>{
 assert.throws(()=>buildDirectory([],{}));
 assert.throws(()=>buildDirectory([row,row],{}));
 assert.throws(()=>buildDirectory([{...row,municipio:'Cancún'}],{}));
});
test('same coordinate for different pharmacy branches is withheld',()=>{
 const data=buildDirectory([row,{...row,nombre:'Sucursal B',direccion:'Calle 2'}],{});
 assert.ok(data.providers.every(p=>!p.coordinates&&p.locationStatus==='conflict'));
});
test('Bupa query uses exact municipality, specialty and expected POST form',async()=>{
 let called=false;
 const result=await queryBupa('directorio',{especialidad:'Pediatría'},async(url,options)=>{
  called=true;assert.equal(url,'https://www.bupasalud.com.mx/salud_api.php');assert.equal(options.method,'POST');
  assert.equal(options.body.get('estado'),'Yucatán');assert.equal(options.body.get('municipio'),'Mérida');assert.equal(options.body.get('especialidad'),'Pediatría');
  return {ok:true,json:async()=>[row]};
 });
 assert.ok(called);assert.equal(result.length,1);
});
