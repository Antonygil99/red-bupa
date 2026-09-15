// Extrae el estilo `linear` de iconsax-astro y arma el sprite <symbol> que usa la app.
import { readFile, writeFile } from 'node:fs/promises';
const ICONS = {
 pin:'Location', cross:'Hospital', search:'SearchNormal1', locate:'Gps', arrow:'ArrowRight',
 clock:'Clock', phone:'Call', close:'CloseCircle', info:'InfoCircle', route:'Routing',
 // Una por categoría del directorio, más los controles de la barra lateral.
 category:'Category', pediatria:'Profile2user', 'medicina-general':'Health', hospital:'Hospital',
 laboratorio:'Drop', farmacia:'Shop', collapse:'SidebarLeft', expand:'ArrowRight2',
};
const symbols = [];
for (const [id, name] of Object.entries(ICONS)) {
 const source = await readFile(new URL(`../node_modules/iconsax-astro/dist/${name}.astro`, import.meta.url), 'utf8');
 const linear = source.match(/'linear':\s*'([^']*)'/)?.[1];
 if (!linear) throw new Error(`iconsax-astro/${name}.astro no expone el estilo linear.`);
 // El grosor lo controla global.css para que los iconos escalen con el contexto.
 symbols.push(`  <symbol id="i-${id}" viewBox="0 0 24 24">${linear.replace(/\s*stroke-width="[^"]*"/g, '')}</symbol>`);
}
const file = `---\n// Generado por scripts/build-icons.mjs desde iconsax-astro. No editar a mano.\n---\n<svg class="svg-defs" aria-hidden="true"><defs>\n${symbols.join('\n')}\n</defs></svg>\n`;
await writeFile(new URL('../src/components/IconSprite.astro', import.meta.url), file);
console.log(`${symbols.length} iconos Iconsax (linear) escritos en src/components/IconSprite.astro`);
