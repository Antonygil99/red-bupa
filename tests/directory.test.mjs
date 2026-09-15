import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { distance, inArea, normalize, scheduledNow } from '../src/lib/directory.mjs';
const data=JSON.parse(await readFile(new URL('../src/data/directory.json',import.meta.url),'utf8'));
test('imports every category without inventing data',()=>{
 assert.ok(data.categories.length>0);
 assert.equal(data.providers.length,data.categories.reduce((total,c)=>total+c.count,0));
 assert.equal(new Set(data.providers.map(p=>p.id)).size,data.providers.length);
 assert.ok(data.providers.every(p=>data.categories.some(c=>c.id===p.category)));
 assert.ok(data.providers.every(p=>data.municipalities.some(m=>m.name===p.municipality)));
 assert.ok(data.notice.length>0);
});
test('keeps declared activity and never enables booking for inactive profiles',()=>{
 assert.ok(data.providers.every(p=>typeof p.active==='boolean'&&typeof p.bookingEnabled==='boolean'));
 assert.ok(data.providers.every(p=>p.active||!p.bookingEnabled));
});
test('coordinates outside Mérida stay off the map but are preserved',()=>{
 const broken=data.providers.filter(p=>!p.coordinates);
 assert.ok(broken.every(p=>p.coordinateIssue&&p.originalCoordinates));
 assert.ok(broken.every(p=>!inArea(p.originalCoordinates.lat,p.originalCoordinates.lng)));
 assert.ok(data.providers.every(p=>!p.coordinates||inArea(p.coordinates.lat,p.coordinates.lng)));
});
test('accent-insensitive search',()=>{assert.equal(normalize('  MÉRIDA  '),'merida');assert.ok(normalize('Mónica Trujillo Salazar').includes(normalize('monica')));});
test('distances are in kilometers and area excludes corrupt coordinate',()=>{assert.equal(distance([21,-89.6],[21,-89.6]),0);assert.ok(Math.abs(distance([21,-89.6],[21.01,-89.6])-1.112)<.01);assert.equal(inArea(89.6303005,-89.6280803),false);assert.equal(inArea(20.984,-89.619),true);assert.equal(inArea(19.4,-99.1),false);});
test('Mérida timezone, split shifts and end-time boundaries',()=>{
 const schedule=['09:00-13:30 Y 16:00-18:30',null,null,null,null,null,null];
 assert.equal(scheduledNow(schedule,new Date('2026-09-07T15:00:00Z')),true);
 assert.equal(scheduledNow(schedule,new Date('2026-09-07T19:30:00Z')),false);
 assert.equal(scheduledNow(schedule,new Date('2026-09-07T22:00:00Z')),true);
 assert.equal(scheduledNow(schedule,new Date('2026-09-08T00:30:00Z')),false);
 assert.equal(scheduledNow(schedule,new Date('2026-09-08T15:00:00Z')),false);
});
