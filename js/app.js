import { Viewer } from './viewer.js';
import { DEFAULTS, BED, NOZZLES, printOf } from './geometry.js';
import { SHAPES, sectionPath } from './shapes.js';
import { PATTERNS, PATTERN_BY_ID, drawPatternThumb } from './patterns.js';
import { FILAMENT_BRANDS } from './filaments.js';

const $ = (id) => document.getElementById(id);

// ── Armonía de colores ─────────────────────────────────────────────────────
// Reglas clásicas de la rueda de color, medidas en OKLCH (un espacio donde las
// distancias se parecen a lo que ve el ojo): dos colores «pegan» si sus tonos
// están a 0° (tono sobre tono), ~30° (análogos), ~120° (tríada), ~150°
// (complementario partido) o ~180° (complementarios), o si uno es neutro o
// apagado. A 60° y 90° también hay relación, pero más floja.
function oklch(hex) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI, A, B };
}
const HARMONIES = [[0, 'tono sobre tono', 1], [30, 'análogos', 1], [60, 'tonos vecinos', 0.74], [90, 'tétrada', 0.78], [120, 'tríada', 1], [150, 'complementario partido', 1], [180, 'complementarios', 1]];
// Devuelve { score 0..1, rel } para la pareja de colores a + b.
function harmony(hexA, hexB) {
  const a = oklch(hexA), b = oklch(hexB);
  const dL = Math.abs(a.L - b.L), dE = Math.hypot(a.L - b.L, a.A - b.A, a.B - b.B);
  if (dE < 0.05) return { score: 0, rel: 'casi el mismo color' };
  const sep = Math.min(1, dE / 0.22); // que se distingan las dos piezas
  const nA = a.C < 0.035, nB = b.C < 0.035;
  if (nA && nB) return { score: 0.55 + 0.4 * Math.min(1, dL / 0.5), rel: 'neutros' };
  if (nA || nB) return { score: (0.7 + 0.14 * Math.min(1, dL / 0.4) + 0.12 * Math.min(1, Math.max(a.C, b.C) / 0.16)) * sep, rel: 'neutro + color' };
  let d = Math.abs(a.h - b.h) % 360;
  if (d > 180) d = 360 - d;
  let best = 0, rel = '';
  // un color apagado u oscuro hace casi de neutro: va con cualquier tono si
  // la claridad cambia (mostaza + verde pino, terracota + azul marino…)
  const mC = Math.min(a.C, b.C);
  if (mC < 0.1) { best = 0.85 - (0.2 * (mC - 0.035)) / 0.065 + 0.1 * Math.min(1, dL / 0.35) - 0.25 * Math.max(0, 1 - dL / 0.15); rel = 'color + tono apagado'; }
  for (const [t, name, w] of HARMONIES) {
    let v = w * Math.exp(-((d - t) ** 2) / (2 * 13 * 13));
    if (t === 0) v *= Math.min(1, dL / 0.22); // mismo tono: que cambie la claridad
    if (v > best) { best = v; rel = name; }
  }
  // dos colores muy chillones a la vez cansan: se premia que uno mande
  const loud = Math.min(a.C, b.C) > 0.17 ? 0.9 : 1;
  return best < 0.35 ? { score: best * sep * loud, rel: 'sin relación clara' } : { score: best * sep * loud, rel };
}
// Los `max` colores de `palette` ([nombre, hex]) que mejor van con `base`,
// repartidos entre relaciones para que no salgan todos del mismo tipo.
function suggestColors(base, palette, max = 10) {
  const per = {}, out = [];
  const all = palette.map(([n, h]) => ({ n, h, o: oklch(h), ...harmony(base, h) })).sort((x, y) => y.score - x.score);
  // no repetir casi el mismo color (dos rojos parecidos de la misma marca)
  const near = (x, y) => Math.hypot(x.L - y.L, x.A - y.A, x.B - y.B) < 0.09;
  for (const c of all) {
    if (out.length >= max || c.score < 0.6) break;
    if ((per[c.rel] || 0) >= (c.rel === 'neutro + color' ? 7 : 3) || out.some((x) => near(x.o, c.o))) continue;
    per[c.rel] = (per[c.rel] || 0) + 1; out.push(c);
  }
  return out;
}

// ── Datos ──────────────────────────────────────────────────────────────────
const FILAMENTS = [
  ['Blanco', '#F1F0EB'], ['Hueso', '#E3DAC6'], ['Gris', '#AEB2AD'], ['Grafito', '#3A3D40'], ['Negro', '#1C1D1F'],
  ['Terracota', '#B5573B'], ['Coral', '#E8705A'], ['Rosa', '#E6A3B3'], ['Naranja', '#E9762B'], ['Rojo', '#C0322E'],
  ['Mostaza', '#E3B23C'], ['Lima', '#B4CC3F'], ['Salvia', '#9DB394'], ['Oliva', '#6E7B3A'], ['Pino', '#24503F'],
  ['Turquesa', '#2C9C95'], ['Cielo', '#7FB6DE'], ['Cobalto', '#2D4FB3'], ['Lavanda', '#A99BD0'], ['Madera', '#A6784C'],
];
// Filamentos reales: la marca y la línea elegidas se recuerdan en el navegador
// (no forman parte del diseño: en el enlace solo viaja el color).
const FIL_KEY = 'tiesto.filamento';
let filPick = { brand: '', line: '' };
try { const v = JSON.parse(localStorage.getItem(FIL_KEY)); if (v && typeof v.brand === 'string') filPick = { brand: v.brand, line: String(v.line || '') }; } catch {}
const filLines = () => (FILAMENT_BRANDS.find(([b]) => b === filPick.brand) || [null, []])[1];
const filColors = () => { const L = filLines(); return (L.find(([l]) => l === filPick.line) || L[0] || [null, []])[1]; };
const colorName = (hex) => {
  const h = hex.toLowerCase();
  const real = filColors().find(([, c]) => '#' + c.toLowerCase() === h);
  if (real) return `${filPick.brand} · ${real[0]}`;
  return (FILAMENTS.find(([, c]) => c.toLowerCase() === h) || [hex.toUpperCase()])[0];
};

const pat = (o) => ({ ...DEFAULTS.pot, ...o });
const PRESETS = [
  { name: 'Hexa', p: {} },
  { name: 'Torre', p: { shape: 'circle', height: 190, width: 112, baseScale: 0.9, twist: 0, resHeight: 70, pot: pat({ type: 'flutes', count: 40, amp: 1.4, shape: 0.7 }), res: pat({ type: 'ribs', count: 40, amp: 1.2, shape: 0.25 }), colors: { pot: '#F1F0EB', res: '#3A3D40' } } },
  { name: 'Panal', p: { shape: 'circle', profile: 'bowl', baseScale: 0.62, height: 125, width: 156, twist: 0, resHeight: 52, pot: pat({ type: 'hex', count: 22, period: 12, amp: 1.1, shape: 0.55 }), res: pat({ type: 'none' }), colors: { pot: '#E3B23C', res: '#1C1D1F' } } },
  { name: 'Flor', p: { shape: 'flower', lobes: 8, lobeDepth: 0.13, twist: 50, height: 140, width: 140, baseScale: 0.74, pot: pat({ type: 'none' }), res: pat({ type: 'waves', count: 8, period: 14, amp: 1.5, shape: 0.4 }), rimStyle: 'scallop', rimCount: 8, rimAmp: 5, colors: { pot: '#E8705A', res: '#9DB394' } } },
  { name: 'Guijarro', p: { shape: 'pebble', seed: 5, lobeDepth: 0.12, twist: 0, height: 120, width: 150, baseScale: 0.7, profile: 'bowl', bulge: 0.06, pot: pat({ type: 'facets', count: 16, period: 15, amp: 2.4, shape: 0.6 }), linkPatterns: true, colors: { pot: '#E3DAC6', res: '#B5573B' } } },
  { name: 'Espiral', p: { shape: 'poly', sides: 5, rounding: 0.55, twist: 110, height: 160, width: 128, pot: pat({ type: 'flutes', count: 30, lean: 0, amp: 1.5 }), res: pat({ type: 'steps', count: 20, period: 7, amp: 1.2 }), colors: { pot: '#A99BD0', res: '#2D4FB3' } } },
  { name: 'Cesta', p: { shape: 'circle', twist: 0, profile: 's', baseScale: 0.8, height: 140, width: 136, pot: pat({ type: 'weave', count: 22, period: 15, amp: 1.8, shape: 0.2 }), res: pat({ type: 'bricks', count: 18, period: 11, amp: 1.3, shape: 0.35 }), rimStyle: 'wave', rimAmp: 3, rimCount: 22, colors: { pot: '#A6784C', res: '#6E7B3A' } } },
  { name: 'Cubo', p: { shape: 'squircle', squareness: 7, twist: 0, height: 125, width: 122, baseScale: 0.92, resHeight: 55, pot: pat({ type: 'ribs', count: 36, amp: 1.3, shape: 0.3 }), res: pat({ type: 'none' }), colors: { pot: '#F1F0EB', res: '#B5573B' } } },
  // modo vaso: una sola pared en espiral, sin costura
  { name: 'Vaso Rizo', p: { vase: true, shape: 'flower', lobes: 9, lobeDepth: 0.1, twist: 80, height: 150, width: 132, baseScale: 0.8, profile: 's', resHeight: 60, pot: pat({ type: 'none' }), linkPatterns: true, colors: { pot: '#F1F0EB', res: '#2C9C95' } } },
  { name: 'Vaso Estrías', p: { vase: true, shape: 'circle', twist: 45, height: 160, width: 124, baseScale: 0.82, bulge: 0.04, resHeight: 64, pot: pat({ type: 'flutes', count: 44, amp: 1.8, shape: 0.6 }), linkPatterns: true, bandRim: 0, bandBase: 0, colors: { pot: '#E8705A', res: '#3A3D40' } } },
  { name: 'Vaso Oleaje', p: { vase: true, shape: 'circle', twist: 0, profile: 'bowl', baseScale: 0.66, height: 130, width: 146, resHeight: 54, pot: pat({ type: 'waves', count: 9, period: 13, amp: 2.2, shape: 0.45 }), linkPatterns: true, colors: { pot: '#7FB6DE', res: '#2D4FB3' } } },
  { name: 'Vaso Gema', p: { vase: true, shape: 'poly', sides: 7, rounding: 0.4, twist: -60, height: 145, width: 134, baseScale: 0.72, resHeight: 58, pot: pat({ type: 'facets', count: 14, period: 16, amp: 2.6, shape: 0.7 }), linkPatterns: true, colors: { pot: '#A99BD0', res: '#F1F0EB' } } },
  { name: 'Vaso Rombos', p: { vase: true, shape: 'squircle', squareness: 4.5, twist: 0, height: 135, width: 126, baseScale: 0.88, resHeight: 56, pot: pat({ type: 'diamonds', count: 20, period: 14, amp: 1.6, shape: 0.3 }), res: pat({ type: 'ribs', count: 40, amp: 1.4, shape: 0.3 }), colors: { pot: '#E3B23C', res: '#1C1D1F' } } },
  // tarros con tapa de rosca
  { name: 'Tarro Hexa', p: { kind: 'jar', shape: 'poly', sides: 6, rounding: 0.3, twist: 0, height: 110, width: 96, baseScale: 1, lidHeight: 24, threadPitch: 4, pot: pat({ type: 'none' }), res: pat({ type: 'none' }), bandSeam: 0, colors: { pot: '#3A3D40', res: '#E3B23C' } } },
  { name: 'Tarro Estrías', p: { kind: 'jar', shape: 'circle', twist: 0, height: 120, width: 90, baseScale: 0.94, bulge: 0.03, lidHeight: 22, threadPitch: 4, pot: pat({ type: 'flutes', count: 48, amp: 1.2, shape: 0.6 }), linkPatterns: true, bandSeam: 1.5, bandRim: 0, colors: { pot: '#F1F0EB', res: '#2C9C95' } } },
  { name: 'Bote Panal', p: { kind: 'jar', shape: 'circle', twist: 0, height: 150, width: 104, baseScale: 0.9, profile: 's', lidHeight: 26, threadPitch: 5, pot: pat({ type: 'ribs', count: 60, amp: 1.1, shape: 0.3 }), res: pat({ type: 'hex', count: 20, period: 12, amp: 1.2, shape: 0.55 }), colors: { pot: '#1C1D1F', res: '#E9762B' } } },
  { name: 'Tarro Flor', p: { kind: 'jar', shape: 'flower', lobes: 8, lobeDepth: 0.1, twist: 0, height: 100, width: 110, baseScale: 0.88, profile: 'bowl', lidHeight: 24, threadPitch: 4, pot: pat({ type: 'none' }), res: pat({ type: 'none' }), colors: { pot: '#E6A3B3', res: '#F1F0EB' } } },
  { name: 'Cajita', p: { kind: 'jar', shape: 'squircle', squareness: 5, twist: 0, height: 55, width: 82, baseScale: 1, lidHeight: 18, threadPitch: 3, threadStarts: 2, pot: pat({ type: 'diamonds', count: 24, period: 8, amp: 1, shape: 0.3 }), res: pat({ type: 'none' }), bandRim: 0, colors: { pot: '#A99BD0', res: '#3A3D40' } } },
  { name: 'Especiero', p: { kind: 'jar', shape: 'circle', twist: 0, height: 95, width: 52, baseScale: 1, lidHeight: 18, threadPitch: 3, threadStarts: 2, wall: 1.6, pot: pat({ type: 'ribs', count: 40, amp: 0.9, shape: 0.3 }), res: pat({ type: 'steps', period: 6, amp: 0.8 }), colors: { pot: '#B5573B', res: '#E3DAC6' } } },
  { name: 'Escamas', p: { shape: 'circle', twist: 0, profile: 'bowl', baseScale: 0.66, bulge: 0.05, height: 135, width: 140, pot: pat({ type: 'scales', count: 18, period: 9, amp: 2, shape: 0.4 }), res: pat({ type: 'none' }), colors: { pot: '#2C9C95', res: '#1C1D1F' } } },
];

// ── Estado ─────────────────────────────────────────────────────────────────
const clone = (o) => JSON.parse(JSON.stringify(o));
// claves que ya no existen (enlaces y diseños guardados antiguos)
const OBSOLETE = ['enforce'];
const merge = (base, o) => {
  const r = clone(base);
  for (const k in o) if (!OBSOLETE.includes(k)) r[k] = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? { ...r[k], ...o[k] } : o[k];
  return r;
};
let state = loadFromHash() || clone(DEFAULTS);
const hist = { past: [], future: [] };
const get = (path) => path.split('.').reduce((o, k) => o[k], state);
const set = (path, v) => {
  const ks = path.split('.');
  const last = ks.pop();
  ks.reduce((o, k) => o[k], state)[last] = v;
};

function encodeState(s) {
  const diff = {};
  for (const k in s) {
    if (typeof s[k] === 'object') {
      const d = {};
      for (const kk in s[k]) if (s[k][kk] !== DEFAULTS[k][kk]) d[kk] = s[k][kk];
      if (Object.keys(d).length) diff[k] = d;
    } else if (s[k] !== DEFAULTS[k]) diff[k] = s[k];
  }
  return btoa(unescape(encodeURIComponent(JSON.stringify(diff)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function loadFromHash() {
  const m = location.hash.match(/d=([\w-]+)/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    return merge(DEFAULTS, JSON.parse(json));
  } catch { return null; }
}

// ── Definición de controles ────────────────────────────────────────────────
const S = (key, label, min, max, step, unit = '', o = {}) => ({ kind: 'slider', key, label, min, max, step, unit, ...o });
const SEG = (key, label, options, o = {}) => ({ kind: 'seg', key, label, options, ...o });
const SW = (key, label, o = {}) => ({ kind: 'switch', key, label, ...o });
const pct = { fmt: (v) => Math.round(v * 100), parse: (v) => v / 100 };
const shapeName = (s) => (s.shape === 'poly' ? ['', '', '', 'Triángulo', 'Cuadrado', 'Pentágono', 'Hexágono', 'Heptágono', 'Octógono'][s.sides] || `${s.sides} lados` : SHAPES.find((x) => x.id === s.shape).name);
const fmt = (v, d = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
// con rosca las dos bases son planas: la maceta lleva suelo plano y mecha de cuerda
const isJar = (s) => s.kind === 'jar';
const isVase = (s) => !!s.vase && !isJar(s);
const plainRim = (s) => isVase(s) || isJar(s);
const isThread = (s) => !isJar(s) && s.joint === 'thread' && !s.vase;
// cómo se llaman las dos piezas: la de arriba (pot) y la de abajo (res)
const partNames = (s) => (isJar(s) ? { pot: 'Tapa', res: 'Tarro' } : { pot: 'Maceta', res: 'Reservorio' });
const lc = (x) => x.toLowerCase();
const wickOf = (s) => (isThread(s) ? 'rope' : s.wick);
// ajustes de la impresora: no forman parte del diseño, se conservan al cambiar de uno a otro
const MACHINE = ['nozzle', 'layerRatio'];
const keepMachine = (s) => { for (const k of MACHINE) s[k] = state[k]; return s; };

const patternItems = (prefix, tint) => [
  { kind: 'patterns', key: `${prefix}.type`, tint },
  S(`${prefix}.amp`, 'Relieve', 0, 4, 0.1, 'mm', { when: (s) => get(`${prefix}.type`) !== 'none' }),
  S(`${prefix}.count`, 'Repeticiones alrededor', 3, 72, 1, '', { when: (s) => get(`${prefix}.type`) !== 'none' && !['steps'].includes(get(`${prefix}.type`)) }),
  S(`${prefix}.period`, 'Alto del motivo', 3, 40, 0.5, 'mm', { when: (s) => !['none', 'flutes', 'ribs'].includes(get(`${prefix}.type`)) }),
  S(`${prefix}.shape`, 'Carácter', 0, 1, 0.01, '%', { ...pct, when: () => !!PATTERN_BY_ID[get(`${prefix}.type`)].knob, label: () => PATTERN_BY_ID[get(`${prefix}.type`)].knob || 'Carácter' }),
  S(`${prefix}.lean`, 'Inclinación', -60, 60, 1, '°', { when: () => !['none', 'steps'].includes(get(`${prefix}.type`)) }),
  S(`${prefix}.seed`, 'Variación', 1, 99, 1, '', { when: () => ['cells', 'facets'].includes(get(`${prefix}.type`)) }),
  SW(`${prefix}.invert`, 'Invertir relieve', { when: () => get(`${prefix}.type`) !== 'none' }),
  SW(`${prefix}.followTwist`, 'Seguir el giro de la forma', { when: () => get(`${prefix}.type`) !== 'none' && state.twist !== 0 }),
];

const SECTIONS = [
  {
    id: 'tipo', title: 'Qué diseñas', mark: 'both', open: true,
    sum: (s) => (isJar(s) ? 'tarro con tapa' : 'maceta autorregante'),
    items: [
      SEG('kind', 'Pieza', [['planter', 'Maceta autorregante'], ['jar', 'Tarro con tapa']]),
      { kind: 'note', when: isJar, text: 'Un tarro y su tapa de rosca, cada uno de un color. La tapa sigue la forma del tarro y se imprime boca abajo, sin soportes.' },
    ],
  },
  {
    id: 'forma', title: 'Forma', mark: 'neutral', open: true,
    sum: (s) => `${shapeName(s)}${s.twist ? ` · giro ${s.twist}°` : ''}`,
    items: [
      { kind: 'shapes' },
      S('sides', 'Lados', 3, 12, 1, '', { when: (s) => s.shape === 'poly' }),
      S('rounding', 'Redondeo de esquinas', 0.02, 1, 0.01, '%', { ...pct, when: (s) => s.shape === 'poly' }),
      S('squareness', 'Cuadratura', 2.5, 12, 0.1, '', { when: (s) => s.shape === 'squircle' }),
      S('lobes', 'Pétalos', 3, 14, 1, '', { when: (s) => s.shape === 'flower' }),
      S('lobeDepth', 'Profundidad', 0.03, 0.3, 0.005, '%', { ...pct, when: (s) => s.shape === 'flower' || s.shape === 'pebble' }),
      S('seed', 'Piedra n.º', 1, 60, 1, '', { when: (s) => s.shape === 'pebble' }),
      S('twist', 'Giro', -180, 180, 1, '°'),
      SEG('twistMode', 'Tipo de giro', [['linear', 'Continuo'], ['wave', 'Vaivén']], { when: (s) => s.twist !== 0 }),
      S('ratio', 'Proporción fondo / ancho', 0.5, 1, 0.01, '%', pct),
    ],
  },
  {
    id: 'tam', title: 'Tamaño y perfil', mark: 'both', open: true,
    sum: (s) => `${s.width} × ${s.height} mm`,
    items: [
      S('height', 'Altura total', 70, 245, 1, 'mm', { min: (s) => (isJar(s) ? 30 : 70) }),
      S('width', 'Ancho', 60, 210, 1, 'mm', { min: (s) => (isJar(s) ? 30 : 60) }),
      S('baseScale', 'Base respecto a la boca', 0.45, 1.1, 0.01, '%', pct),
      SEG('profile', 'Perfil', [['linear', 'Recto'], ['bowl', 'Cuenco'], ['flare', 'Trompeta'], ['s', 'Ese']]),
      S('bulge', 'Barriga', -0.15, 0.2, 0.005, '%', pct),
    ],
  },
  {
    id: 'tarro', title: 'Tapa y rosca', mark: 'pot', open: true, when: isJar,
    sum: (s) => `tapa de ${s.lidHeight} mm · paso ${fmt(s.threadPitch, 1)}`,
    items: [
      S('lidHeight', 'Altura de la tapa', 10, 60, 1, 'mm', { max: (s) => Math.max(10, Math.round(s.height * 0.6)) }),
      S('threadPitch', 'Paso de la rosca', 2, 8, 0.5, 'mm'),
      S('threadStarts', 'Entradas', 1, 4, 1, ''),
      { kind: 'note', text: (s) => `La tapa se cierra girando en el sentido del reloj y se para en un tope de giro justo cuando su forma y su patrón cuadran con los del tarro, sea cual sea la tolerancia de la impresora. Si el dibujo no se repite tantas veces como entradas, la rosca se hace con menos entradas para que no pueda entrar descuadrada.` },
      { kind: 'note', text: 'La holgura de la rosca es la «Holgura del encaje» de Impresión. Antes de imprimir el tarro entero, prueba la tapa con la probeta del cuello.' },
    ],
  },
  {
    id: 'res', title: 'Reservorio', mark: 'res', when: (s) => !isJar(s),
    sum: (s) => `unión a ${s.resHeight} mm${isThread(s) ? ' · rosca' : ''}`,
    items: [
      S('resHeight', 'Altura de la unión', 30, 200, 1, 'mm', { max: (s) => s.height - 30 }),
      S('waterGap', 'Hueco lateral para el agua', 2, 16, 0.5, 'mm'),
      SEG('joint', 'Unión', [['seat', 'Encajada'], ['thread', 'Rosca']], { when: (s) => !isVase(s) }),
      { kind: 'note', text: (s) => (isVase(s)
        ? 'En modo vaso el reservorio se cierra arriba en un aro circular y el cono de la maceta se apoya en él. No hay rosca ni holgura que ajustar.'
        : s.joint === 'thread'
        ? 'La maceta se enrosca en el reservorio hasta asentar en el cono y ya no se suelta al levantarla. Las dos piezas tienen la base plana.'
        : 'La maceta se apoya por su peso en el cono y se levanta tirando hacia arriba.') },
      S('threadPitch', 'Paso de la rosca', 3, 8, 0.5, 'mm', { when: isThread }),
      S('threadStarts', 'Entradas', 1, 4, 1, '', { when: isThread }),
      S('threadLen', 'Largo de la rosca', 6, 30, 1, 'mm', { when: isThread }),
    ],
  },
  {
    id: 'riego', title: 'Riego', mark: 'neutral', when: (s) => !isJar(s),
    sum: (s) => (wickOf(s) === 'cone' ? 'cono de sustrato' : 'mecha de cuerda'),
    items: [
      SEG('wick', 'Sistema', [['cone', 'Cono de sustrato'], ['rope', 'Mecha de cuerda']], { when: (s) => !isThread(s) }),
      { kind: 'note', text: (s) => (wickOf(s) === 'cone'
        ? 'La tierra del cono toca el agua y la sube por capilaridad. No hace falta cuerda.'
        : `${isThread(s) ? 'Con rosca, la maceta lleva suelo plano' : 'Suelo plano'} con un agujero central para una cuerda de algodón que baja al agua.`) },
      S('footDia', 'Diámetro del pie', 20, 90, 1, 'mm', { when: (s) => wickOf(s) === 'cone' }),
      S('ropeDia', 'Agujero de la cuerda', 5, 14, 0.5, 'mm', { when: (s) => wickOf(s) === 'rope' }),
      S('waterDepth', 'Profundidad del agua', 10, 70, 1, 'mm', { when: (s) => wickOf(s) === 'rope' }),
      S('holeDia', 'Agujeros de drenaje', 2, 8, 0.5, 'mm'),
      S('holeCount', 'Número de agujeros', 0, 12, 1, ''),
    ],
  },
  {
    id: 'patpot', title: (s) => `Patrón de la ${lc(partNames(s).pot)}`, mark: 'pot', tint: 'pot', open: true,
    sum: (s) => PATTERN_BY_ID[s.pot.type].name,
    items: patternItems('pot', 'pot'),
  },
  {
    id: 'patres', title: (s) => `Patrón del ${lc(partNames(s).res)}`, mark: 'res', tint: 'res',
    sum: (s) => (s.linkPatterns ? `igual que la ${lc(partNames(s).pot)}` : PATTERN_BY_ID[s.res.type].name),
    items: [
      SW('linkPatterns', () => `Igual que la ${lc(partNames(state).pot)}`, { hint: 'El motivo continúa sin cortes de una pieza a otra.' }),
      ...patternItems('res', 'res').map((it) => ({ ...it, when: ((w) => (s) => !s.linkPatterns && (!w || w(s)))(it.when) })),
    ],
  },
  {
    id: 'borde', title: 'Borde y bandas lisas', mark: 'neutral',
    sum: (s) => (plainRim(s) ? 'borde liso' : { flat: 'borde liso', wave: 'ondas', scallop: 'festón', crown: 'corona' }[s.rimStyle]),
    items: [
      SEG('rimStyle', 'Borde superior', [['flat', 'Liso'], ['wave', 'Ondas'], ['scallop', 'Festón'], ['crown', 'Corona']], { when: (s) => !plainRim(s) }),
      S('rimAmp', 'Altura del borde', 1, 24, 0.5, 'mm', { when: (s) => !plainRim(s) && s.rimStyle !== 'flat' }),
      S('rimCount', 'Repeticiones', 2, 32, 1, '', { when: (s) => !plainRim(s) && s.rimStyle !== 'flat' }),
      S('rimPhase', 'Desfase', -180, 180, 1, '°', { when: (s) => !plainRim(s) && s.rimStyle !== 'flat' }),
      SW('rimRound', 'Canto redondeado', { when: (s) => !plainRim(s) }),
      { kind: 'note', when: (s) => isVase(s), text: 'En modo vaso el borde es siempre liso y plano: la espiral no puede subir y bajar.' },
      { kind: 'sub', text: 'Bandas sin patrón' },
      S('bandRim', 'Junto al borde', 0, 30, 0.5, 'mm'),
      S('bandSeam', 'A ambos lados de la unión', 0, 30, 0.5, 'mm'),
      S('bandBase', 'En la base', 0, 30, 0.5, 'mm'),
    ],
  },
  {
    id: 'color', title: 'Colores', mark: 'both', open: true,
    sum: (s) => `${colorName(s.colors.pot)} + ${colorName(s.colors.res)}`,
    items: [{ kind: 'colors' }],
  },
  {
    id: 'print', title: 'Impresión', mark: 'neutral', open: true,
    sum: (s) => `boquilla ${fmt(printOf(s).nozzle, 1)} · capa ${fmt(printOf(s).layer, 2)} mm${isVase(s) ? ' · vaso' : ''}`,
    items: [
      SEG('nozzle', 'Boquilla (mm)', NOZZLES.map((n) => [n, fmt(n, 1)])),
      S('layerRatio', '', 0.25, 0.75, 0.05, '% de la boquilla', { ...pct, label: () => `Altura de capa: ${fmt(printOf(state).layer, 2)} mm` }),
      { kind: 'note', text: (s) => { const p = printOf(s); return `La vista dibuja las capas (${fmt(p.layer, 2)} mm) y las líneas (${fmt(isVase(s) ? p.vaseLine : p.line, 2)} mm) tal como las dejará esta boquilla. Acércate con la rueda para verlas una a una.`; } },
      SEG('vase', 'Modo', [[false, 'Normal'], [true, 'Vaso (espiral)']], { when: (s) => !isJar(s) }),
      { kind: 'note', when: (s) => isVase(s), text: (s) => `Modo vaso: cada pieza es una sola línea continua de ${fmt(printOf(s).vaseLine, 2)} mm, sin costura ni retracciones. Más rápido y con menos filamento; la pared es más fina.` },
      S('wall', 'Grosor de pared', 0.4, 4, 0.1, 'mm', { when: (s) => !isVase(s) }),
      S('floor', 'Grosor de suelos', 0.6, 4, 0.1, 'mm'),
      S('fit', '', 0.15, 1, 0.05, 'mm', { when: (s) => !isVase(s), label: () => (isJar(state) ? 'Holgura de la rosca' : 'Holgura del encaje') }),
      S('maxOverhang', 'Voladizo máximo', 35, 60, 1, '°'),
      S('chamfer', 'Chaflán anti pie de elefante', 0, 1.2, 0.05, 'mm'),
      { kind: 'note', text: (s) => `Sin soportes siempre: cualquier relieve, giro o forma que se abra más de ${s.maxOverhang}° se suaviza solo.` },
      { kind: 'note', text: () => `Volumen de impresión: ${BED.x} × ${BED.y} × ${BED.z} mm (${BED.name}). Cada pieza se imprime por separado, de pie, con su bobina.` },
    ],
  },
];

// ── Construcción del panel ─────────────────────────────────────────────────
const form = document.getElementById('controls');
const bindings = []; // {el, when, sync}
const chev = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let uid = 0;

const OPEN_KEY = 'tiesto.open';
let openSet;
try { const v = JSON.parse(localStorage.getItem(OPEN_KEY)); openSet = Array.isArray(v) ? new Set(v) : null; } catch { openSet = null; }

function buildPanel() {
  for (const sec of SECTIONS) {
    const d = document.createElement('details');
    d.className = 'sec';
    d.open = openSet ? openSet.has(sec.id) : !!sec.open;
    d.addEventListener('toggle', () => {
      const ids = [...form.querySelectorAll('details.sec')].filter((x) => x.open).map((x) => x.dataset.id);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch {}
    });
    d.dataset.id = sec.id;
    d.innerHTML = `<summary><span class="sec-mark ${sec.mark}"></span><span class="sec-title"></span><span class="sec-sum"></span>${chev}</summary>`;
    const body = document.createElement('div');
    body.className = 'sec-body' + (sec.tint ? ` ${sec.tint}-tint` : '');
    d.appendChild(body);
    const sumEl = d.querySelector('.sec-sum');
    const titleEl = d.querySelector('.sec-title');
    bindings.push({ el: d, when: sec.when, sync: () => { sumEl.textContent = sec.sum(state); titleEl.textContent = typeof sec.title === 'function' ? sec.title(state) : sec.title; } });
    for (const it of sec.items) body.appendChild(buildItem(it));
    form.appendChild(d);
  }
}

function buildItem(it) {
  const id = `c${uid++}`;
  let el;
  switch (it.kind) {
    case 'slider': {
      el = document.createElement('div');
      el.className = 'f-slider';
      el.innerHTML = `<label for="${id}"></label><span class="f-val"><input type="number" inputmode="decimal" aria-label=""><span class="unit">${it.unit}</span></span><input type="range" id="${id}">`;
      const lab = el.querySelector('label'), num = el.querySelector('input[type=number]'), rng = el.querySelector('input[type=range]');
      const toUi = (v) => (it.fmt ? it.fmt(v) : v);
      const fromUi = (v) => (it.parse ? it.parse(v) : v);
      const uiStep = it.fmt ? Math.max(1, toUi(it.step)) : it.step;
      const minOf = () => toUi(typeof it.min === 'function' ? it.min(state) : it.min);
      rng.min = minOf(); rng.step = uiStep;
      num.step = uiStep;
      const maxOf = () => toUi(typeof it.max === 'function' ? it.max(state) : it.max);
      const paint = () => { rng.style.setProperty('--p', `${((rng.value - rng.min) / (rng.max - rng.min)) * 100}%`); };
      const decimals = String(uiStep).includes('.') ? String(uiStep).split('.')[1].length : 0;
      const sync = () => {
        const v = toUi(get(it.key));
        rng.min = minOf(); rng.max = maxOf();
        rng.value = v;
        if (document.activeElement !== num) num.value = Number(v).toFixed(decimals);
        const l = typeof it.label === 'function' ? it.label() : it.label;
        lab.textContent = l;
        num.setAttribute('aria-label', `${l} (${it.unit || 'valor'})`);
        paint();
      };
      rng.addEventListener('input', () => {
        set(it.key, fromUi(Number(rng.value)));
        num.value = Number(rng.value).toFixed(decimals);
        paint();
        changed({ live: true });
      });
      rng.addEventListener('change', () => commit());
      rng.addEventListener('dblclick', () => {
        const dv = it.key.split('.').reduce((o, k) => o[k], DEFAULTS);
        set(it.key, dv); commit(); syncAll();
      });
      num.addEventListener('change', () => {
        let v = Number(String(num.value).replace(',', '.'));
        if (!Number.isFinite(v)) { sync(); return; }
        v = Math.min(maxOf(), Math.max(minOf(), v));
        set(it.key, fromUi(v));
        commit();
        syncAll();
      });
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
      bindings.push({ el, when: it.when, sync });
      break;
    }
    case 'seg': {
      el = document.createElement('div');
      el.className = 'f-seg';
      el.innerHTML = `<span id="${id}">${it.label}</span><div class="seg" role="radiogroup" aria-labelledby="${id}"></div>`;
      const g = el.querySelector('.seg');
      for (const [v, l] of it.options) {
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = l; b.dataset.v = v;
        b.addEventListener('click', () => { set(it.key, v); commit(); syncAll(); });
        g.appendChild(b);
      }
      radioKeys(g);
      bindings.push({ el, when: it.when, sync: () => g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(get(it.key))))) });
      break;
    }
    case 'switch': {
      el = document.createElement('div');
      el.className = 'f-switch';
      el.innerHTML = `<span id="${id}"><span class="sw-label"></span>${it.hint ? `<small>${it.hint}</small>` : ''}</span><button type="button" class="switch" role="switch" aria-labelledby="${id}"></button>`;
      const b = el.querySelector('button'), swLab = el.querySelector('.sw-label');
      b.addEventListener('click', () => { set(it.key, !get(it.key)); commit(); syncAll(); });
      bindings.push({ el, when: it.when, sync: () => { swLab.textContent = typeof it.label === 'function' ? it.label() : it.label; b.setAttribute('aria-checked', String(!!get(it.key))); } });
      break;
    }
    case 'shapes': {
      el = document.createElement('div');
      el.className = 'tiles';
      el.setAttribute('role', 'radiogroup');
      el.setAttribute('aria-label', 'Forma de la sección');
      for (const sh of SHAPES) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tile'; b.setAttribute('role', 'radio'); b.dataset.v = sh.id;
        const demo = { ...DEFAULTS, shape: sh.id, sides: 6, rounding: 0.3, squareness: 4.5, lobes: 6, lobeDepth: 0.16, seed: 3 };
        b.innerHTML = `<span class="face"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="${sectionPath(demo, 40)}"/></svg></span>${sh.name}`;
        b.addEventListener('click', () => { state.shape = sh.id; commit(); syncAll(); });
        el.appendChild(b);
      }
      radioKeys(el);
      bindings.push({ el, sync: () => el.querySelectorAll('.tile').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === state.shape))) });
      break;
    }
    case 'patterns': {
      el = document.createElement('div');
      el.className = 'tiles pat';
      el.setAttribute('role', 'radiogroup');
      el.setAttribute('aria-label', 'Patrón');
      const canvases = [];
      for (const p of PATTERNS) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tile'; b.setAttribute('role', 'radio'); b.dataset.v = p.id;
        b.innerHTML = `<span class="face"><canvas width="72" height="72"></canvas></span>${p.name}`;
        canvases.push([b.querySelector('canvas'), p.id]);
        b.addEventListener('click', () => { set(it.key, p.id); commit(); syncAll(); });
        el.appendChild(b);
      }
      radioKeys(el);
      let lastColor = null;
      bindings.push({
        el, when: it.when,
        sync: () => {
          el.querySelectorAll('.tile').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === get(it.key))));
          const col = state.colors[it.tint];
          if (col !== lastColor) { lastColor = col; for (const [cv, pid] of canvases) drawPatternThumb(cv, pid, col); }
        },
      });
      break;
    }
    case 'colors': {
      el = document.createElement('div');
      el.className = 'colors';
      // selector de marca y línea de filamento, común a las dos piezas
      const pick = document.createElement('div');
      pick.className = 'fil-pick';
      pick.innerHTML = '<span>Filamento real</span><select aria-label="Marca de filamento"></select><select aria-label="Línea de filamento"></select>';
      const [selB, selL] = pick.querySelectorAll('select');
      selB.innerHTML = '<option value="">Sin marca</option>' + FILAMENT_BRANDS.map(([b]) => `<option>${b}</option>`).join('');
      const realGrids = [];
      const fillReal = () => {
        const L = filLines();
        if (!L.some(([l]) => l === filPick.line)) filPick.line = (L.find(([l]) => l === 'PLA') || L[0] || [''])[0];
        selB.value = filPick.brand;
        selL.innerHTML = L.map(([l, c]) => `<option value="${l}">${l} (${c.length})</option>`).join('');
        selL.value = filPick.line; selL.hidden = !L.length;
        const cols = filColors();
        for (const [g2, part] of realGrids) {
          g2.hidden = !cols.length;
          g2.replaceChildren(...cols.map(([n, c]) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'sw'; b.setAttribute('role', 'radio'); b.title = n; b.setAttribute('aria-label', n);
            b.style.setProperty('--c', '#' + c); b.dataset.v = '#' + c;
            b.addEventListener('click', () => { state.colors[part] = '#' + c; commit(); syncAll(); });
            return b;
          }));
        }
        try { localStorage.setItem(FIL_KEY, JSON.stringify(filPick)); } catch {}
      };
      selB.addEventListener('change', () => { filPick = { brand: selB.value, line: '' }; fillReal(); syncAll(); });
      selL.addEventListener('change', () => { filPick.line = selL.value; fillReal(); syncAll(); });
      el.appendChild(pick);
      for (const part of ['pot', 'res']) {
        const box = document.createElement('div');
        box.innerHTML = '<div class="color-head"><span></span><em></em></div><div class="swatches" role="radiogroup"></div>';
        const g = box.querySelector('.swatches'), em = box.querySelector('em'), head = box.querySelector('.color-head span');
        for (const [n, hex] of FILAMENTS) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'sw'; b.setAttribute('role', 'radio'); b.title = n; b.setAttribute('aria-label', n);
          b.style.setProperty('--c', hex); b.dataset.v = hex;
          b.addEventListener('click', () => { state.colors[part] = hex; commit(); syncAll(); });
          g.appendChild(b);
        }
        const cu = document.createElement('label');
        cu.className = 'sw custom'; cu.title = 'Otro color';
        cu.innerHTML = '<input type="color" aria-label="Otro color">';
        const inp = cu.querySelector('input');
        inp.addEventListener('input', () => { state.colors[part] = inp.value; changed({ live: true }); syncAll(); });
        inp.addEventListener('change', () => commit());
        g.appendChild(cu);
        radioKeys(g);
        const g2 = document.createElement('div');
        g2.className = 'swatches real'; g2.setAttribute('role', 'radiogroup'); g2.hidden = true;
        box.appendChild(g2); realGrids.push([g2, part]);
        radioKeys(g2);
        // colores de la paleta a la vista que pegan con el de la otra pieza
        const other = part === 'pot' ? 'res' : 'pot';
        const sug = document.createElement('div');
        sug.className = 'sug';
        sug.innerHTML = '<span></span><div class="swatches" role="group"></div>';
        const sugHead = sug.querySelector('span'), sugGrid = sug.querySelector('.swatches');
        box.appendChild(sug);
        let sugKey = '';
        const syncSug = () => {
          const base = state.colors[other], names = partNames(state);
          const key = [base, state.colors[part], filPick.brand, filPick.line, names[other]].join('|');
          if (key === sugKey) return;
          sugKey = key;
          const cols = filColors();
          const list = suggestColors(base, cols.length ? cols.map(([n, c]) => [n, '#' + c]) : FILAMENTS);
          sug.hidden = !list.length;
          sugHead.textContent = `Pegan con ${lc(names[other])}`;
          sugGrid.replaceChildren(...list.map((c) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'sw'; b.title = `${c.n} · ${c.rel}`; b.setAttribute('aria-label', b.title);
            b.setAttribute('aria-pressed', String(c.h.toLowerCase() === state.colors[part].toLowerCase()));
            b.style.setProperty('--c', c.h);
            b.addEventListener('click', () => { state.colors[part] = c.h; commit(); syncAll(); });
            return b;
          }));
        };
        bindings.push({ sync: syncSug });
        bindings.push({
          sync: () => {
            const label = partNames(state)[part];
            head.textContent = label;
            g.setAttribute('aria-label', `Color de ${lc(label)}`);
            const cur = state.colors[part].toLowerCase();
            let found = false;
            g2.setAttribute('aria-label', `Color de ${lc(label)} en filamento ${filPick.brand}`);
            box.querySelectorAll('.sw[data-v]').forEach((b) => { const on = b.dataset.v.toLowerCase() === cur; found ||= on; b.setAttribute('aria-checked', String(on)); });
            cu.setAttribute('aria-checked', String(!found));
            inp.value = state.colors[part].length === 7 ? state.colors[part] : '#888888';
            em.textContent = colorName(state.colors[part]);
          },
        });
        el.appendChild(box);
      }
      fillReal();
      // veredicto de la pareja actual
      const verdict = document.createElement('p');
      verdict.className = 'pair-fit';
      bindings.push({
        sync: () => {
          const h = harmony(state.colors.pot, state.colors.res);
          const lvl = h.score >= 0.75 ? ['ok', 'Pegan bien'] : h.score >= 0.5 ? ['mid', 'Pegan regular'] : ['bad', 'No pegan mucho'];
          verdict.dataset.lvl = lvl[0];
          verdict.textContent = `${lvl[1]}: ${h.rel}`;
        },
      });
      el.appendChild(verdict);
      const src = document.createElement('p');
      src.className = 'note';
      src.textContent = 'Colores de marca según SpoolmanDB (los que declara cada fabricante). Son orientativos: el tono real cambia con la pantalla, la luz y el lote, y aquí no se ven brillos de seda ni transparencias. Lo de «pegar» sigue las reglas de la rueda de color: es una ayuda, no una ley.';
      el.appendChild(src);
      break;
    }
    case 'note': {
      el = document.createElement('p');
      el.className = 'note';
      bindings.push({ el, when: it.when, sync: () => { el.textContent = typeof it.text === 'function' ? it.text(state) : it.text; } });
      break;
    }
    case 'sub': {
      el = document.createElement('p');
      el.className = 'sub';
      el.textContent = it.text;
      break;
    }
  }
  return el;
}

// Flechas para moverse dentro de un grupo de radios
function radioKeys(group) {
  group.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    const items = [...group.querySelectorAll('[role=radio]')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = items[(i + keys[e.key] + items.length) % items.length];
    n.focus(); n.click();
  });
}

function syncAll() {
  for (const b of bindings) {
    if (b.el && b.when) b.el.classList.toggle('f-hidden', !b.when(state));
    b.sync();
  }
  const root = document.documentElement.style;
  root.setProperty('--c-pot', state.colors.pot);
  root.setProperty('--c-res', state.colors.res);
  viewer.setColors(state.colors.pot, state.colors.res);
  const nm = partNames(state);
  $('tPotName').textContent = $('xPotName').textContent = nm.pot;
  $('tResName').textContent = $('xResName').textContent = nm.res;
  $('couponTitle').textContent = isJar(state) ? 'Probeta de rosca' : 'Probeta de encaje';
  document.getElementById('undoBtn').disabled = !hist.past.length;
  document.getElementById('redoBtn').disabled = !hist.future.length;
}

// ── Historial y cambios ────────────────────────────────────────────────────
let committed = clone(state);
let urlTimer = 0;
function commit() {
  if (JSON.stringify(committed) !== JSON.stringify(state)) {
    hist.past.push(committed);
    if (hist.past.length > 80) hist.past.shift();
    hist.future = [];
    committed = clone(state);
  }
  changed({ live: false });
}
function changed({ live }) {
  if (state.resHeight > state.height - 30) state.resHeight = Math.max(30, state.height - 30);
  if (isJar(state)) state.lidHeight = Math.min(state.lidHeight, Math.max(10, Math.round(state.height * 0.6)));
  requestBuild(live ? 'draft' : 'preview');
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    window.history.replaceState(null, '', `#d=${encodeState(state)}`);
  }, 400);
  syncAll();
}
function undo() {
  if (!hist.past.length) return;
  hist.future.push(clone(state));
  state = hist.past.pop();
  committed = clone(state);
  changed({ live: false });
}
function redo() {
  if (!hist.future.length) return;
  hist.past.push(clone(state));
  state = hist.future.pop();
  committed = clone(state);
  changed({ live: false });
}

// ── Trabajador de geometría ────────────────────────────────────────────────
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let inflight = false, pending = null, reqId = 0, refineTimer = 0, busyTimer = 0, lastResult = null;
const busyEl = document.getElementById('busy');

function requestBuild(quality) {
  pending = quality === 'preview' || !pending ? quality : pending;
  clearTimeout(refineTimer);
  if (quality === 'draft') refineTimer = setTimeout(() => requestBuild('preview'), 260);
  pump();
}
// Máxima calidad: una fila de malla por capa de impresión. En móviles o equipos con poca
// memoria se usa «ultraLite» (≈1,5 M triángulos) en vez de «ultra» (hasta 6 M).
let hq = false;
const lite = (navigator.deviceMemory && navigator.deviceMemory < 4) || matchMedia('(pointer: coarse)').matches;
const hqLevel = lite ? 'ultraLite' : 'ultra';
function pump() {
  if (inflight || !pending) return;
  const quality = pending === 'preview' && hq ? hqLevel : pending;
  busyEl.textContent = quality === hqLevel && hq ? 'Calculando a máxima calidad…' : 'Calculando…';
  $('hqBtn').setAttribute('aria-busy', String(quality === hqLevel && hq));
  pending = null;
  inflight = true;
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => (busyEl.hidden = false), 160);
  worker.postMessage({ id: ++reqId, params: clone(state), quality });
}
worker.onmessage = (ev) => {
  inflight = false;
  $('hqBtn').setAttribute('aria-busy', 'false');
  clearTimeout(busyTimer);
  busyEl.hidden = true;
  const { result, error } = ev.data;
  if (error) { console.error(error); toast('No se ha podido generar este diseño. Prueba otros valores.'); }
  else { lastResult = result; viewer.setResult(result); renderInfo(result); }
  pump();
};
worker.onerror = (e) => { console.error(e); toast('Error en el generador de geometría.'); };

// ── Resumen y comprobaciones ───────────────────────────────────────────────
const ICON = {
  ok: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  error: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
const mobileChecks = document.createElement('ul');
mobileChecks.className = 'mobile-checks';
document.querySelector('.panel-head').appendChild(mobileChecks);

function renderInfo(r) {
  const i = r.info;
  const dim = (s, h) => `${fmt(s[0])} × ${fmt(s[1])} × ${fmt(h)} mm`;
  $('tPotDim').textContent = dim(i.pot.size, i.pot.height);
  $('tResDim').textContent = dim(i.res.size, i.res.height);
  $('tPotG').textContent = `${fmt(i.pot.grams)} g`;
  $('tResG').textContent = `${fmt(i.res.grams)} g`;
  const jar = i.kind === 'jar';
  $('tWater').textContent = `${fmt(Math.round((jar ? i.capacityMl : i.waterMl) / 5) * 5)} ml`;
  $('tWaterLbl').textContent = jar ? 'de capacidad' : 'de agua';
  $('tSoil').textContent = jar ? `${fmt(i.mouth)} mm` : `${fmt(i.soilL, 2)} L`;
  $('tSoilLbl').textContent = jar ? 'de boca' : 'de sustrato';
  document.querySelector('.btn-coupon').hidden = !i.coupon;
  if (jar) $('couponInfo').textContent = `Solo el cuello, para probar la rosca con la tapa · ≈ ${fmt(i.coupon.grams)} g`;
  else if (i.coupon) $('couponInfo').textContent = `Dos aros con solo ${i.thread ? 'la rosca y el cono' : 'el cono'} · ≈ ${fmt(i.coupon.grams)} g en total`;
  const pr = i.print;

  const items = [];
  const fits = i.pot.fits && i.res.fits;
  if (fits) items.push(['ok', `Cabe en la ${BED.name}`]);
  const over = (r.overhangArea.pot + r.overhangArea.res) / 100;
  const islands = r.islands ? r.islands.pot + r.islands.res : 0;
  if (over < 0.4 && !islands) items.push(['ok', `Sin soportes: nada pasa de ${state.maxOverhang}° ni empieza en el aire`]);
  else if (over < 0.4) { /* el aviso de partes en el aire llega en r.warnings */ }
  else items.push(['error', `${fmt(over, 1)} cm² con voladizo de más de ${state.maxOverhang}°`]);
  items.push(['ok', pr.vase
    ? `Modo vaso · boquilla ${fmt(pr.nozzle, 1)} mm · una línea de ${fmt(pr.vaseLine, 2)} mm · ${fmt(pr.layersPot)} + ${fmt(pr.layersRes)} capas de ${fmt(pr.layer, 2)} mm`
    : `Boquilla ${fmt(pr.nozzle, 1)} mm · pared de ${pr.perimeters} ${pr.perimeters === 1 ? 'línea' : 'líneas'} · ${fmt(pr.layersPot)} + ${fmt(pr.layersRes)} capas de ${fmt(pr.layer, 2)} mm`]);
  if (jar) {
    const th = i.thread;
    items.push(['ok', `Rosca de ${th.starts} ${th.starts === 1 ? 'entrada' : 'entradas'} y paso ${fmt(th.pitch, 1)} mm: ${fmt(th.turns, 1)} vueltas para cerrar, ${fmt(state.fit, 2)} mm de holgura`]);
    items.push(['ok', 'La tapa se imprime boca abajo, apoyada en su cara plana']);
  } else if (pr.vase) items.push(['ok', 'La maceta asienta por contacto en el aro del reservorio']);
  else if (i.thread) {
    const th = i.thread;
    items.push(['ok', `Rosca de ${th.starts} ${th.starts === 1 ? 'entrada' : 'entradas'} y paso ${fmt(th.pitch, 1)} mm: ${fmt(th.turns, 1)} vueltas para enroscar, ${fmt(state.fit, 2)} mm de holgura`]);
  } else items.push(['ok', `Encaje cónico con ${fmt(state.fit, 2)} mm de holgura`]);
  for (const w of r.warnings) if (!w.text.startsWith('Hay zonas')) items.push([w.level, w.text]);
  const html = items.map(([lv, t]) => `<li class="${lv}">${ICON[lv] || ICON.info}<span>${t}</span></li>`).join('');
  $('checks').innerHTML = html;
  mobileChecks.innerHTML = items.filter(([lv]) => lv !== 'ok').map(([lv, t]) => `<li class="${lv}">${ICON[lv]}<span>${t}</span></li>`).join('');
}

// ── Exportación ────────────────────────────────────────────────────────────
function download(name, data) {
  const type = name.endsWith('.stl') ? 'model/stl' : name.endsWith('.3mf') ? 'model/3mf' : 'application/zip';
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function runExport(kind, btn) {
  if (btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  const label = btn.querySelector('.btn-label') || btn.querySelector('#couponInfo');
  const prev = label ? label.textContent : null;
  if (label) label.textContent = 'Preparando archivos…';
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const done = () => { btn.removeAttribute('aria-busy'); if (label) label.textContent = prev; w.terminate(); };
  w.onmessage = (ev) => {
    if (ev.data.error) { console.error(ev.data.error); toast('No se ha podido exportar.'); done(); return; }
    for (const f of ev.data.files) download(f.name, f.data);
    toast({ zip: isJar(state) ? 'Descargados el tarro y la tapa' : 'Descargadas la maceta y el reservorio', coupon: 'Probeta descargada: mira el LEEME para interpretar el ajuste' }[kind] || 'Descarga lista');
    done();
  };
  w.onerror = () => { toast('No se ha podido exportar.'); done(); };
  w.postMessage({ id: 1, params: clone(state), quality: $('qualitySel').value, exportKind: kind });
}

// ── Presets, guardados, aleatorio ──────────────────────────────────────────
const SAVED_KEY = 'tiesto.saved';
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; } };
function renderPresets() {
  const box = $('presets');
  box.innerHTML = '';
  const chip = (name, p, saved, idx) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'preset' + (saved ? ' saved' : ''); b.setAttribute('role', 'listitem');
    const s = saved ? p : merge(DEFAULTS, p);
    b.innerHTML = `<span class="pair" aria-hidden="true"><i style="background:${s.colors.pot}"></i><i style="background:${s.colors.res}"></i></span>${name}`;
    b.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) return;
      state = saved ? merge(DEFAULTS, clone(p)) : keepMachine(merge(DEFAULTS, p));
      commit(); syncAll();
    });
    if (saved) {
      const x = document.createElement('span');
      x.className = 'x'; x.textContent = '×'; x.title = 'Borrar'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', `Borrar ${name}`);
      x.addEventListener('click', () => {
        const list = loadSaved(); list.splice(idx, 1);
        try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch {}
        renderPresets();
      });
      b.appendChild(x);
    }
    box.appendChild(b);
  };
  PRESETS.forEach((pr) => chip(pr.name, pr.p, false));
  const saved = loadSaved();
  if (saved.length) {
    const sep = document.createElement('span'); sep.className = 'preset-sep'; box.appendChild(sep);
    saved.forEach((sv, i) => chip(sv.name, sv.p, true, i));
  }
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b, st = 1) => Math.round((a + Math.random() * (b - a)) / st) * st;
function randomize() {
  const shape = pick(['circle', 'poly', 'poly', 'squircle', 'flower', 'pebble']);
  const t1 = pick(PATTERNS.filter((p) => p.id !== 'none')).id;
  const t2 = Math.random() < 0.35 ? 'none' : pick(PATTERNS.filter((p) => p.id !== 'none')).id;
  const mkPat = (type) => ({ ...DEFAULTS.pot, type, amp: rnd(1, 2.6, 0.1), count: rnd(10, 40), period: rnd(6, 18, 0.5), shape: Math.random(), lean: Math.random() < 0.2 ? rnd(-35, 35) : 0, seed: rnd(1, 99) });
  let cp, cr;
  do { cp = pick(FILAMENTS)[1]; cr = pick(FILAMENTS)[1]; } while (cp === cr);
  const height = rnd(110, 190);
  state = merge(DEFAULTS, {
    shape, sides: rnd(3, 9), rounding: rnd(0.15, 0.7, 0.01), squareness: rnd(3, 8, 0.1), lobes: rnd(5, 10), lobeDepth: rnd(0.07, 0.16, 0.005), seed: rnd(1, 60),
    twist: Math.random() < 0.4 ? 0 : rnd(-90, 90, 5), twistMode: Math.random() < 0.2 ? 'wave' : 'linear',
    height, width: rnd(110, 160), baseScale: rnd(0.62, 0.95, 0.01), profile: pick(['linear', 'linear', 'bowl', 's', 'flare']),
    bulge: Math.random() < 0.3 ? rnd(-0.05, 0.1, 0.005) : 0, resHeight: Math.round(height * rnd(0.36, 0.48, 0.01)),
    pot: mkPat(t1), res: mkPat(t2), linkPatterns: Math.random() < 0.15,
    rimStyle: pick(['flat', 'flat', 'wave', 'scallop', 'crown']), rimAmp: rnd(3, 8), rimCount: rnd(4, 12),
    colors: { pot: cp, res: cr },
    joint: state.joint, threadPitch: state.threadPitch, threadStarts: state.threadStarts, threadLen: state.threadLen,
    vase: state.vase, nozzle: state.nozzle, layerRatio: state.layerRatio,
    kind: state.kind, lidHeight: state.lidHeight,
  });
  if (isJar(state)) Object.assign(state, { height: rnd(60, 160), width: rnd(60, 120), baseScale: rnd(0.8, 1.05, 0.01), threadPitch: pick([3, 4, 4, 5]), threadStarts: 2 });
  commit(); syncAll();
  const b = $('randomBtn');
  b.classList.remove('rolling'); void b.offsetWidth; b.classList.add('rolling');
}

// ── Avisos breves ──────────────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ── Arranque ───────────────────────────────────────────────────────────────
const viewer = new Viewer($('view'));
viewer.onInteract = () => $('hint').classList.add('gone');
buildPanel();
renderPresets();
syncAll();
requestBuild('preview');

document.querySelectorAll('.seg-view button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.seg-view button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    viewer.setView(b.dataset.view);
  });
});
radioKeys(document.querySelector('.seg-view'));
$('overhangBtn').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  viewer.setOverhang(on);
});
$('hqBtn').addEventListener('click', (e) => {
  hq = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(hq));
  viewer.setHQ(hq);
  requestBuild('preview');
  if (hq) toast(lite ? 'Alta calidad (limitada en este dispositivo)' : `Máxima calidad: una fila de malla por cada capa de ${fmt(printOf(state).layer, 2)} mm`);
});
$('snapBtn').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  if (b.getAttribute('aria-busy') === 'true') return;
  b.setAttribute('aria-busy', 'true');
  toast('Creando la imagen…');
  await new Promise((r) => setTimeout(r, 30));
  let shot = null;
  // 8K en ordenador, 4K en móvil; si el navegador no puede con tanto, a la mitad
  for (const side of lite ? [4096, 2048] : [8192, 4096]) {
    try { shot = await viewer.snapshot(side); } catch (err) { console.error(err); shot = null; }
    if (shot) break;
  }
  b.removeAttribute('aria-busy');
  if (!shot) { toast('No se ha podido crear la imagen.'); return; }
  download('tiesto.png', shot.blob);
  toast(`Imagen guardada · ${shot.width} × ${shot.height} px`);
});
$('nozzleSel').innerHTML = NOZZLES.map((n) => `<option value="${n}">${fmt(n, 1)} mm</option>`).join('');
$('nozzleSel').addEventListener('change', (e) => { state.nozzle = Number(e.target.value); commit(); syncAll(); });
bindings.push({ sync: () => { $('nozzleSel').value = String(printOf(state).nozzle); } });
syncAll();
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('randomBtn').addEventListener('click', randomize);
$('dlZip').addEventListener('click', (e) => runExport('zip', e.currentTarget));
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => runExport(b.dataset.export, b)));
$('shareBtn').addEventListener('click', async () => {
  window.history.replaceState(null, '', `#d=${encodeState(state)}`);
  try { await navigator.clipboard.writeText(location.href); toast('Enlace copiado: abre exactamente este diseño'); }
  catch { toast('Copia la dirección de la barra del navegador'); }
});
$('saveBtn').addEventListener('click', () => {
  const list = loadSaved();
  const name = `${shapeName(state)} ${list.length + 1}`;
  list.push({ name, p: clone(state) });
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); toast(`Guardado como «${name}»`); }
  catch { toast('Este navegador no deja guardar. Usa «Copiar enlace».'); }
  renderPresets();
});
addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  if (e.target.matches('input[type=number], input[type=text]')) return;
  e.preventDefault();
  e.shiftKey ? redo() : undo();
});
addEventListener('hashchange', () => {
  const s = loadFromHash();
  if (s && JSON.stringify(s) !== JSON.stringify(state)) { state = s; commit(); syncAll(); }
});
