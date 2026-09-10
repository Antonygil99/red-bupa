import { readFile, mkdir, writeFile } from 'node:fs/promises';
const read = async name => JSON.parse((await readFile(new URL('../Yucatán/' + name, import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
const rows = await read('lista-pediatría-merida.txt');
const municipalities = await read('lista-municipios.txt');
const days = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];
const providers = rows.map(p => {
 const lat = Number(p.latitud), lng = Number(p.longitud);
 const valid = lat >= 20.75 && lat <= 21.25 && lng >= -89.85 && lng <= -89.4;
 return {id:p.idProveedor,name:p.nombre,neighborhood:p.colonia,address:p.direccion,postalCode:p.cp,municipality:p.municipio,specialty:p.especialidad,phone:p.telefonO1,secondaryPhone:p.telefonO2||null,price:p.costo||null,coordinates:valid?{lat,lng}:null,originalCoordinates:{lat,lng},coordinateIssue:valid?null:'Las coordenadas del archivo están fuera de la zona de Mérida.',schedule:days.map(day=>p['horariO_'+day]||null),active:p.activo,bookingEnabled:p.elegibleAgenda,virtualEnabled:p.elegibleVirtual};
});
const data = {municipalities:municipalities.map(m=>({id:m.IdMunicipio,name:m.NombreMunicipio})),specialties:[...new Set(rows.map(p=>p.especialidad))],providers};
await mkdir(new URL('../src/data/',import.meta.url),{recursive:true});
await writeFile(new URL('../src/data/directory.json',import.meta.url), JSON.stringify(data,null,2)+'\n');
console.log(`${providers.length} perfiles importados; ${providers.filter(p=>!p.coordinates).length} ubicación por verificar. El catálogo de especialidades vacío se deriva de los perfiles.`);
