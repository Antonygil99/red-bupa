import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Cada archivo original de Yucatán/ aporta una categoría del directorio. No se editan.
const SOURCES = [
 {file:'lista-pediatría-merida.txt', category:'pediatria', label:'Pediatría'},
 {file:'lista-medicina-general-merida.txt', category:'medicina-general', label:'Medicina general'},
 {file:'lista-hospitales-merida.txt', category:'hospital', label:'Hospitales'},
 {file:'lista-laboratorios-merida.txt', category:'laboratorio', label:'Laboratorios'},
 {file:'lista-farmacias-merida.txt', category:'farmacia', label:'Farmacias'},
];
const DAYS = ['LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'];
const read = async name => {
 const raw = (await readFile(new URL('../Yucatán/' + name, import.meta.url), 'utf8')).replace(/^\uFEFF/, '').trim();
 return raw ? JSON.parse(raw) : [];
};

const municipalities = await read('lista-municipios.txt');
const notice = (await readFile(new URL('../Yucatán/aviso-cobertura.txt', import.meta.url), 'utf8')).replace(/^\uFEFF/, '').trim();
const providers = [];
const empty = [];
const seen = new Set();

for (const source of SOURCES) {
 const rows = await read(source.file);
 if (!rows.length) { empty.push(source.label); continue; }
 for (const p of rows) {
  const lat = Number(p.latitud), lng = Number(p.longitud);
  const valid = lat >= 20.75 && lat <= 21.25 && lng >= -89.85 && lng <= -89.4;
  let id = p.idProveedor;
  if (seen.has(id)) { let n = 2; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
  seen.add(id);
  // El retrato se busca por el id de origen, que puede repetirse entre sucursales.
  const photo = existsSync(new URL(`../public/fotos/${p.idProveedor}.png`, import.meta.url)) ? `/fotos/${p.idProveedor}.png` : null;
  providers.push({
   id, category: source.category,
   name: String(p.nombre).trim(), neighborhood: p.colonia, address: p.direccion, postalCode: p.cp,
   municipality: p.municipio, specialty: p.especialidad,
   phone: p.telefonO1, secondaryPhone: p.telefonO2 || null, price: p.costo || null,
   coordinates: valid ? {lat, lng} : null,
   originalCoordinates: {lat, lng},
   coordinateIssue: valid ? null : 'Las coordenadas del archivo están fuera de la zona de Mérida.',
   photo,
   schedule: DAYS.map(day => p['horariO_' + day] || null),
   active: p.activo, bookingEnabled: p.elegibleAgenda, virtualEnabled: p.elegibleVirtual,
  });
 }
}

const categories = SOURCES
 .filter(s => providers.some(p => p.category === s.category))
 .map(s => ({id: s.category, label: s.label, count: providers.filter(p => p.category === s.category).length}));

const data = {
 notice,
 categories,
 municipalities: municipalities.map(m => ({id: m.IdMunicipio, name: m.NombreMunicipio})),
 specialties: [...new Set(providers.map(p => p.specialty))],
 providers,
};
await mkdir(new URL('../src/data/', import.meta.url), {recursive: true});
await writeFile(new URL('../src/data/directory.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log(`${providers.length} perfiles importados en ${categories.length} categorías; ${providers.filter(p => !p.coordinates).length} ubicación por verificar; ${providers.filter(p => p.photo).length} con retrato.`);
if (empty.length) console.log(`Sin datos en el archivo original: ${empty.join(', ')}. Esa categoría no aparece en la app.`);
