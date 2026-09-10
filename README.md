# Cerca · Pediatras en Mérida

Aplicación estática con Astro, TypeScript, Leaflet y GSAP. Datos locales en `src/data/directory.json`; sin backend, cuentas ni reservas.

## Desarrollo

```sh
npm install
npm run dev
```

## Datos

```sh
npm run data:import
```

Importa los archivos originales de `Yucatán/` sin modificarlos. Relaciona los municipios por nombre; el archivo de especialidades está vacío, así que el catálogo se deriva de los perfiles. Mantiene los siete perfiles, sus IDs, indicadores de actividad y horarios. Una latitud incorrecta de Lidia Carolina Chavez Cordova se conserva en `originalCoordinates`, pero se excluye del mapa y de búsquedas por radio. No se inventan coordenadas, precios, fotografías, reseñas o disponibilidad.

Todos los registros indican `activo: false`; se presentan exclusivamente como directorio de actividad por confirmar. Se requiere verificar estos datos antes de ofrecer citas.

## Ubicación y mapa

El permiso se solicita al pulsar «Usar mi ubicación». Se maneja denegación, timeout, posición no disponible, navegador incompatible, conexión no segura y ubicación fuera de cobertura. Las coordenadas del visitante solo viven en memoria. Al autorizarlas se ordena por distancia en línea recta y se aplica un radio inicial de 5 km. El mapa restringe la navegación a ese entorno; «Todo Mérida» vuelve a ampliar la zona. La cobertura es un rectángulo operativo aproximado, **no un polígono administrativo oficial** del municipio: para una validación municipal exacta se necesita un GeoJSON oficial.

Cartografía externa CARTO/OpenStreetMap con atribución. Los perfiles siguen disponibles cuando falla el mapa. Los enlaces de indicaciones abren Google Maps; comparten destino y, cuando existe, origen autorizado. No se calcula ni se simula una ruta dentro de la app.

El filtro «En horario» usa `America/Merida`, admite horarios partidos y no equivale a disponibilidad confirmada. Los días vacíos muestran «Sin horario registrado».

## Validación

```sh
npm test
npm run build
```

Pruebas de integridad de datos, búsqueda sin acentos, distancias, cobertura, zona horaria y horarios partidos. Animaciones respetan `prefers-reduced-motion`; la interfaz incluye navegación de teclado, toasts anunciados y alternativa de lista móvil.

No se dispone de un contexto WebMCP de validación en este entorno; su integración es opcional y se detecta por capacidades del navegador.
