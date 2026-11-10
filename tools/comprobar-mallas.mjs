// Genera varias macetas de prueba y comprueba que cada malla es cerrada (cada arista
// compartida por 2 triángulos), bien orientada y sin triángulos degenerados.
// Uso: node tools/comprobar-mallas.mjs
import { build, DEFAULTS, QUALITY } from '../web/js/geometry.js';
function check(m, name) {
  const ix = m.indices, edges = new Map();
  for (let i = 0; i < ix.length; i += 3) for (let a = 0; a < 3; a++) {
    const u = ix[i + a], v = ix[i + (a + 1) % 3];
    const key = u < v ? u + ',' + v : v + ',' + u;
    const dir = u < v ? 1 : -1;
    const e = edges.get(key) || [0, 0]; e[0]++; e[1] += dir; edges.set(key, e);
  }
  let bad = 0, unb = 0;
  for (const [k, e] of edges) { if (e[0] !== 2) bad++; else if (e[1] !== 0) unb++; }
  // degenerate tris
  const p = m.positions; let degen = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]*3, b = ix[i+1]*3, c = ix[i+2]*3;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    const l=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx); if (l<1e-6) degen++;
  }
  console.log(name, 'tris', ix.length/3, 'nonManifoldEdges', bad, 'badOrient', unb, 'degenerate', degen);
}
// Compartimentos cerrados: en cada columna, el perfil sube por fuera, cruza el
// borde y baja por dentro. Si por dentro vuelve a subir, hay un hueco separado
// del principal (p. ej. detrás de la rosca) donde no llega el agua o la tierra.
function compartments(m, N, skip = 0) {
  const p = m.positions, Pc = (p.length / 3 - skip) / N;
  let bad = 0;
  for (let j = 0; j < N; j++) {
    let top = 0;
    for (let q = 1; q < Pc; q++) if (p[(j * Pc + q) * 3 + 2] > p[(j * Pc + top) * 3 + 2] + 1e-6) top = q;
    for (let q = top + 1; q < Pc; q++) if (p[(j * Pc + q) * 3 + 2] > p[(j * Pc + q - 1) * 3 + 2] + 1e-4) { bad++; break; }
  }
  return bad;
}
const variants = [
  ['default', {}],
  ['circle-rope', { shape: 'circle', wick: 'rope', twist: 0, pot: { ...DEFAULTS.pot, type: 'hex' }, rimStyle: 'scallop' }],
  ['flower', { shape: 'flower', twist: 60, pot: { ...DEFAULTS.pot, type: 'cells', amp: 2 }, res: { ...DEFAULTS.res, type: 'bricks' }, rimStyle: 'crown' }],
  ['squircle', { shape: 'squircle', profile: 'bowl', bulge: 0.1, pot: { ...DEFAULTS.pot, type: 'scales' }, res: { ...DEFAULTS.res, type: 'weave' } }],
  ['pebble-diamantes', { shape: 'pebble', pot: { ...DEFAULTS.pot, type: 'diamonds', amp: 3, period: 5 } }],
  ['rosca', { joint: 'thread' }],
  ['rosca-flor-1entrada', { joint: 'thread', shape: 'flower', twist: 60, threadPitch: 8, threadStarts: 1, threadLen: 20, waterGap: 2 }],
  ['rosca-trompeta', { joint: 'thread', shape: 'circle', twist: 0, profile: 'flare', baseScale: 0.5, height: 110, width: 160, resHeight: 45 }],
  ['vaso-default', { vase: true }],
  ['vaso-flor-ondas', { vase: true, nozzle: 0.8, shape: 'flower', twist: 70, linkPatterns: true, pot: { ...DEFAULTS.pot, type: 'waves', amp: 2.5, period: 14 } }],
  ['vaso-cuenco-cuerda', { vase: true, nozzle: 0.2, shape: 'circle', twist: 0, wick: 'rope', profile: 'bowl', baseScale: 0.6, pot: { ...DEFAULTS.pot, type: 'lattice', amp: 3 }, res: { ...DEFAULTS.res, type: 'facets', amp: 3 } }],
  ['vaso-cubo-nervios', { vase: true, nozzle: 1, shape: 'squircle', squareness: 8, joint: 'thread', rimStyle: 'crown', pot: { ...DEFAULTS.pot, type: 'ribs', amp: 4, count: 60 }, res: { ...DEFAULTS.res, type: 'bricks', amp: 4 } }],
  ['tarro-default', { kind: 'jar' }],
  ['tarro-mini', { kind: 'jar', shape: 'circle', twist: 0, height: 40, width: 45, lidHeight: 12, threadPitch: 3, threadStarts: 1 }],
  ['tarro-flor-giro', { kind: 'jar', shape: 'flower', twist: 80, height: 160, width: 110, lidHeight: 35, pot: { ...DEFAULTS.pot, type: 'hex', amp: 3 }, res: { ...DEFAULTS.res, type: 'bricks', amp: 3 } }],
  ['tarro-cuenco-0.8', { kind: 'jar', shape: 'squircle', profile: 'bowl', baseScale: 0.5, bulge: 0.15, height: 120, width: 150, nozzle: 0.8, threadPitch: 8, threadStarts: 4, lidHeight: 30 }],
  ['tarro-triangulo-invertido', { kind: 'jar', shape: 'poly', sides: 3, rounding: 0.05, twist: -120, height: 140, width: 120, vase: true, pot: { ...DEFAULTS.pot, type: 'diamonds', amp: 4, invert: true }, linkPatterns: true }],
  ['rosca-cubo-baja', { joint: 'thread', shape: 'squircle', squareness: 7, resHeight: 40, threadStarts: 3 }],
];
for (const [n, o] of variants) {
  const P = { ...DEFAULTS, ...o };
  for (const q of ['preview', 'export']) {
    const t0 = performance.now();
    const r = build(P, q);
    const dt = performance.now() - t0;
    console.log(`\n== ${n} [${q}] ${dt.toFixed(0)} ms`);
    check(r.pot, ' pot'); check(r.res, ' res');
    if (r.coupon) for (const [cn, cm] of Object.entries(r.coupon)) check(cm, ` probeta ${cn}`);
    console.log(' islas (partes en el aire)', JSON.stringify(r.islands));
    const NQ = QUALITY[q].N;
    console.log(' columnas con compartimentos cerrados', JSON.stringify({ pot: compartments(r.pot, NQ, r.info.holes * 40), res: compartments(r.res, NQ) }));
    if (q === 'preview') {
      const i = r.info;
      console.log(' pot vol', (i.pot.volume/1000).toFixed(1),'cm3 g', i.pot.grams.toFixed(0), 'size', i.pot.size.map(x=>x.toFixed(1)).join('x'), 'h', i.pot.height.toFixed(1));
      console.log(' res vol', (i.res.volume/1000).toFixed(1),'cm3 g', i.res.grams.toFixed(0), 'size', i.res.size.map(x=>x.toFixed(1)).join('x'));
      if (i.kind === 'jar') console.log(' capacidad ml', i.capacityMl.toFixed(0), 'boca', i.mouth.toFixed(1), 'rosca', JSON.stringify(i.thread));
      else console.log(' water ml', i.waterMl.toFixed(0), 'soil L', i.soilL.toFixed(2), 'za', i.za.toFixed(1), 'rIns', i.rIns.toFixed(1), 'rf', i.rf.toFixed(1), 'zTop', i.zTopMin.toFixed(1), i.zTopMax.toFixed(1), 'zpb', i.zpb, 'holes', i.holes, 'thread', JSON.stringify(i.thread));
      console.log(' overhang mm2', r.overhangArea.pot.toFixed(0), r.overhangArea.res.toFixed(0), r.warnings.map(w=>w.text));
    }
  }
}
