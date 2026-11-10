// Patrones de superficie. Cada patrón es f(u, v) ∈ [0, 1], donde
//   u = posición alrededor, en celdas (periódica cada `count`)
//   v = altura, en periodos verticales
// El desplazamiento real (mm) es amplitud · f · peso de las bandas lisas.
// `shape` (0..1) es el "carácter" de cada patrón: su etiqueta va en `knob`.

const TAU = Math.PI * 2;
const SQ3 = Math.sqrt(3);

const fract = (x) => x - Math.floor(x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const tri = (x) => Math.abs(fract(x) - 0.5) * 2; // 1 en los enteros, 0 en medio
const mod = (a, n) => ((a % n) + n) % n;

function hash2(i, j, s = 0) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Distancias al centro más cercano y al segundo en una red (hexagonal o con jitter).
function cellDist(u, v, count, jitter, seed, hex) {
  let d1 = 1e9, d2 = 1e9;
  if (hex) {
    // centros: (i + 0.5·(j impar), j·√3/2) — vecinos a distancia 1
    const Y = v;
    const j0 = Math.floor(Y / (SQ3 / 2));
    for (let j = j0 - 1; j <= j0 + 2; j++) {
      const off = (j & 1) * 0.5;
      const i0 = Math.floor(u - off);
      for (let i = i0 - 1; i <= i0 + 2; i++) {
        const dx = u - (i + off), dy = Y - j * (SQ3 / 2);
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
    }
    return [d1, d2];
  }
  const i0 = Math.floor(u), j0 = Math.floor(v);
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      const wi = mod(i, count);
      const px = i + 0.5 + (hash2(wi, j, seed) - 0.5) * jitter;
      const py = j + 0.5 + (hash2(wi, j, seed + 7) - 0.5) * jitter;
      const d = Math.hypot(u - px, v - py);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  }
  return [d1, d2];
}

export const PATTERNS = [
  { id: 'none', name: 'Liso', knob: null, f: () => 0 },
  {
    id: 'flutes', name: 'Estrías', knob: 'Redondez',
    f: (u, v, s) => Math.pow(0.5 + 0.5 * Math.cos(TAU * u), 0.4 + (1 - s) * 3),
  },
  {
    id: 'ribs', name: 'Nervios', knob: 'Grosor',
    f: (u, v, s) => { const x = tri(u + 0.5); const w = 0.12 + 0.6 * s; return smooth(w + 0.1, w - 0.04, x); },
  },
  {
    id: 'steps', name: 'Escalones', knob: 'Curva',
    // crece despacio hacia arriba y cae de golpe: la cara que cae mira hacia arriba
    f: (u, v, s) => Math.pow(fract(v), 0.5 + s * 1.5),
  },
  {
    id: 'waves', name: 'Ondas', knob: 'Oleaje',
    f: (u, v, s) => 0.5 + 0.5 * Math.cos(TAU * (v + (0.15 + s * 0.6) * Math.sin(TAU * u))),
  },
  {
    id: 'zigzag', name: 'Zigzag', knob: 'Quiebro',
    f: (u, v, s) => Math.pow(0.5 + 0.5 * Math.cos(TAU * (u + (0.2 + s * 0.8) * tri(v))), 1.6),
  },
  {
    id: 'diamonds', name: 'Rombos', knob: 'Meseta',
    f: (u, v, s) => {
      const o = (Math.floor(v) & 1) * 0.5;
      const d = Math.abs(fract(u + o) - 0.5) + Math.abs(fract(v) - 0.5);
      return clamp01((1 - 2 * d) / (1 - 0.85 * s));
    },
  },
  {
    id: 'lattice', name: 'Celosía', knob: 'Grosor',
    f: (u, v, s) => {
      const w = 0.1 + 0.35 * s;
      const a = smooth(w + 0.12, w, 1 - tri(u + v)), b = smooth(w + 0.12, w, 1 - tri(u - v));
      return Math.max(a, b);
    },
  },
  {
    id: 'hex', name: 'Panal', knob: 'Pared',
    f: (u, v, s, count) => {
      const [d1, d2] = cellDist(u, v * SQ3 / 2, count, 0, 0, true);
      const w = 0.04 + 0.22 * s;
      return smooth(w + 0.06, w, d2 - d1);
    },
  },
  {
    id: 'cells', name: 'Celdas', knob: 'Pared',
    f: (u, v, s, count, seed) => {
      const [d1, d2] = cellDist(u, v, count, 0.85, seed, false);
      const w = 0.03 + 0.2 * s;
      return smooth(w + 0.08, w, d2 - d1);
    },
  },
  {
    id: 'scales', name: 'Escamas', knob: 'Solape',
    f: (u, v, s) => {
      const R = 0.62 + 0.25 * s;
      let best = -1e9, val = 0;
      const j0 = Math.floor(v);
      for (let j = j0 - 1; j <= j0 + 2; j++) {
        const off = (j & 1) * 0.5;
        const i0 = Math.floor(u - off);
        for (let i = i0 - 1; i <= i0 + 1; i++) {
          const cx = i + off + 0.5, cy = j;
          const dx = (u - cx) / R, dy = (v - cy) / (R * 1.1);
          const r2 = dx * dx + dy * dy;
          // la escama de más abajo queda por encima (gana la de centro más bajo)
          if (r2 < 1 && -cy > best) { best = -cy; val = 0.35 + 0.65 * clamp01(0.5 - dy * 0.5) * Math.sqrt(1 - r2 * 0.6); }
        }
      }
      return val;
    },
  },
  {
    id: 'bricks', name: 'Ladrillos', knob: 'Junta',
    f: (u, v, s) => {
      const o = (Math.floor(v) & 1) * 0.5;
      const m = 0.03 + 0.12 * s;
      const dx = 0.5 - Math.abs(fract(u + o) - 0.5), dy = 0.5 - Math.abs(fract(v) - 0.5);
      return smooth(m, m + 0.06, Math.min(dx, dy * 0.6));
    },
  },
  {
    id: 'weave', name: 'Cestería', knob: 'Hebras',
    f: (u, v, s) => {
      const n = s < 0.5 ? 2 : 3;
      const i = Math.floor(u), j = Math.floor(v), fu = fract(u), fv = fract(v);
      if ((i + j) & 1) return Math.pow(Math.sin(Math.PI * fract(fv * n)), 0.6) * (0.6 + 0.4 * Math.sin(Math.PI * fu));
      return Math.pow(Math.sin(Math.PI * fract(fu * n)), 0.6) * (0.6 + 0.4 * Math.sin(Math.PI * fv));
    },
  },
  {
    id: 'facets', name: 'Facetado', knob: 'Contraste',
    f: (u, v, s, count, seed) => {
      const i = Math.floor(u), j = Math.floor(v), fu = fract(u), fv = fract(v);
      const h = (a, b) => hash2(mod(a, count), b, seed);
      const h00 = h(i, j), h10 = h(i + 1, j), h01 = h(i, j + 1), h11 = h(i + 1, j + 1);
      let r;
      if (hash2(mod(i, count), j, seed + 3) < 0.5) {
        r = fu + fv < 1 ? h00 + fu * (h10 - h00) + fv * (h01 - h00) : h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11);
      } else {
        r = fu > fv ? h00 + fu * (h10 - h00) + fv * (h11 - h10) : h00 + fv * (h01 - h00) + fu * (h11 - h01);
      }
      const c = 0.6 + s * 1.6;
      return clamp01(0.5 + (r - 0.5) * c);
    },
  },
  {
    id: 'dots', name: 'Puntos', knob: 'Tamaño',
    f: (u, v, s, count) => {
      const [d1] = cellDist(u, v * SQ3 / 2, count, 0, 0, true);
      const R = 0.22 + 0.24 * s;
      return Math.sqrt(Math.max(0, 1 - (d1 / R) ** 2));
    },
  },
];

export const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));

// Construye d(θ, z) en mm para unos parámetros de patrón y un contexto de forma.
export function makePattern(pp, ctx) {
  const def = PATTERN_BY_ID[pp.type] || PATTERNS[0];
  if (def.id === 'none' || pp.amp <= 0) return null;
  const count = Math.max(1, Math.round(pp.count));
  const cellW = (TAU * ctx.rref) / count;
  const lean = Math.tan((pp.lean * Math.PI) / 180) / cellW;
  const period = Math.max(2, pp.period);
  const s = pp.shape, seed = Math.round(pp.seed || 1);
  const amp = pp.amp, inv = !!pp.invert, follow = pp.followTwist !== false;
  const f = def.f;
  return (theta, z) => {
    const th = follow ? theta - ctx.twist(z) : theta;
    let u = (th / TAU) * count + z * lean;
    u = mod(u, count);
    const v = z / period;
    let val = f(u, v, s, count, seed);
    if (inv) val = 1 - val;
    return amp * val;
  };
}

// Miniatura en relieve sombreado (para el selector de patrones).
export function drawPatternThumb(canvas, id, color = '#8a8f87', knob = 0.5) {
  const def = PATTERN_BY_ID[id];
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const c = parseInt(color.slice(1), 16);
  const cr = (c >> 16) & 255, cg = (c >> 8) & 255, cb = c & 255;
  const cu = 2.5, cv = 2.5;
  const F = (x, y) => (def.id === 'none' ? 0 : def.f((x / W) * cu + 0.25, ((H - y) / H) * cv + 0.1, knob, 64, 3));
  const L = [-0.55, 0.6, 0.6];
  const ll = Math.hypot(...L);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = F(x, y);
      const gx = (F(x + 1, y) - F(x - 1, y)) * 7, gy = (F(x, y - 1) - F(x, y + 1)) * 7;
      const n = [-gx, -gy, 1];
      const nl = Math.hypot(...n);
      let sh = (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * ll);
      sh = 0.55 + 0.55 * sh + h * 0.08;
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, cr * sh);
      img.data[i + 1] = Math.min(255, cg * sh);
      img.data[i + 2] = Math.min(255, cb * sh);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
