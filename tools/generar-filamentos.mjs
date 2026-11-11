// Genera web/js/filaments.js: colores de filamentos de marcas conocidas, sacados
// de SpoolmanDB (https://github.com/Donkie/SpoolmanDB, licencia MIT). Son los
// colores que declara cada fabricante o la comunidad, no medidas de laboratorio.
// Uso: node tools/generar-filamentos.mjs [filaments.json ya descargado]
import { readFileSync, writeFileSync } from 'node:fs';
const URL_DB = 'https://donkie.github.io/SpoolmanDB/filaments.json';
const src = process.argv[2];
const db = src ? JSON.parse(readFileSync(src, 'utf8')) : await (await fetch(URL_DB)).json();

// marca en la base de datos → nombre que se enseña (en este orden)
const BRANDS = [
  ['eSun', 'eSUN'], ['ELEGOO', 'Elegoo'], ['ANYCUBIC', 'Anycubic'], ['JAYO', 'Jayo'], ['Sunlu', 'Sunlu'],
  ['Creality', 'Creality'], ['Bambu Lab', 'Bambu Lab'], ['Polymaker', 'Polymaker'], ['Prusament', 'Prusament'],
  ['Overture', 'Overture'], ['Kingroon', 'Kingroon'], ['GEEETECH', 'Geeetech'], ['Eryone', 'Eryone'],
  ['FlashForge', 'FlashForge'], ['Hatchbox', 'Hatchbox'], ['AmazonBasics', 'Amazon Basics'],
];
const MATERIALS = ['PLA', 'PLA+', 'PETG'];
const FINISH = { matte: ' mate', glossy: ' brillo' };

const out = [];
for (const [key, label] of BRANDS) {
  const lines = new Map();
  for (const f of db) {
    if (f.manufacturer !== key || !MATERIALS.includes(f.material)) continue;
    // fuera: multicolor, translúcidos, fosforescentes y colores mal apuntados
    if (f.color_hexes || f.translucent || f.glow || /glow/i.test(f.name) || !/^[0-9a-f]{6}$/i.test(f.color_hex || '')) continue;
    const line = f.material + (FINISH[f.finish] || '');
    if (!lines.has(line)) lines.set(line, new Map());
    const name = f.name.replace(/\s+/g, ' ').trim();
    if (!lines.get(line).has(name)) lines.get(line).set(name, f.color_hex.toUpperCase());
  }
  const L = [...lines].filter(([, m]) => m.size >= 3).sort((a, b) => a[0].localeCompare(b[0]));
  if (L.length) out.push([label, L.map(([n, m]) => [n, [...m]])]);
}
const total = out.reduce((a, [, L]) => a + L.reduce((b, [, c]) => b + c.length, 0), 0);
const body = out.map(([b, L]) => `  [${JSON.stringify(b)}, [\n${L.map(([n, c]) => `    [${JSON.stringify(n)}, ${JSON.stringify(c)}],`).join('\n')}\n  ]],`).join('\n');
writeFileSync(new URL('../web/js/filaments.js', import.meta.url), `// Generado por tools/generar-filamentos.mjs a partir de SpoolmanDB (MIT) el ${new Date().toISOString().slice(0, 10)}.
// No editar a mano. [marca, [[línea, [[nombre, hex], …]], …]]
export const FILAMENT_BRANDS = [
${body}
];
`);
console.log(`${out.length} marcas, ${total} colores`);
for (const [b, L] of out) console.log(' ', b, L.map(([n, c]) => `${n}: ${c.length}`).join(' · '));
