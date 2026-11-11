// Motor de geometría: genera la maceta (interior) y el reservorio (cubeta
// exterior) como mallas cerradas y estancas, listas para imprimir de pie.
//
// Cada pieza es un "torno generalizado": para cada ángulo θ hay un perfil
// (r, z) que sube por fuera, pasa por el borde y baja por dentro hasta el
// suelo. Todas las columnas tienen el mismo número de puntos, así que unir
// columnas vecinas da una superficie cerrada; el fondo y el suelo interior se
// triangulan aparte (con agujeros de drenaje en la maceta).
//
// Sin soportes:
//  - la parte de la maceta que entra en el reservorio es circular y baja en
//    conos a (voladizo máx − 3°): asiento autocentrante y cono de sustrato.
//  - cada columna se limita siempre para que la pared exterior no se abra (ni
//    la interior se cierre) más rápido que ese ángulo: ningún diseño puede
//    necesitar soportes.
//  - la rosca (opcional) es una hélice sobre esa parte circular, con flancos a
//    la misma pendiente que los conos.

import { ShapeUtils, Vector2 } from '../vendor/three/three.module.min.js';
import { buildSectionLUT, offsetRow } from './shapes.js';
import { makePattern } from './patterns.js';

export const BED = { x: 220, y: 220, z: 250, name: 'Ender 3 V3 SE' };

export const DEFAULTS = {
  shape: 'poly', sides: 6, rounding: 0.35, squareness: 4, lobes: 7, lobeDepth: 0.14, seed: 3,
  width: 130, ratio: 1, height: 150, baseScale: 0.78, profile: 'linear', bulge: 0, twist: 30, twistMode: 'linear',
  resHeight: 62, waterGap: 4,
  joint: 'seat', threadPitch: 5, threadStarts: 2, threadLen: 12,
  wick: 'cone', footDia: 44, holeDia: 4, holeCount: 6, ropeDia: 8, waterDepth: 25,
  linkPatterns: false,
  pot: { type: 'flutes', amp: 1.6, count: 36, period: 12, lean: 0, shape: 0.55, invert: false, seed: 1, followTwist: true },
  res: { type: 'steps', amp: 1.4, count: 24, period: 8, lean: 0, shape: 0.3, invert: false, seed: 1, followTwist: true },
  bandBase: 3, bandRim: 3, bandSeam: 0,
  rimStyle: 'flat', rimAmp: 6, rimCount: 6, rimPhase: 0, rimRound: true,
  wall: 2, floor: 2, fit: 0.4, maxOverhang: 45, chamfer: 0.5,
  nozzle: 0.4, layerRatio: 0.5, vase: false,
  // 'planter' = maceta autorregante · 'jar' = tarro con tapa de rosca
  kind: 'planter', lidHeight: 22,
  colors: { pot: '#E3B23C', res: '#24503F' },
};

export const QUALITY = {
  draft: { N: 112, dz: 1.3, K: 5 },
  preview: { N: 176, dz: 0.8, K: 7 },
  export: { N: 288, dz: 0.45, K: 9 },
  high: { N: 400, dz: 0.3, K: 11 },
  // descarga «Máximo»: el STL más fino que un laminador abre con soltura
  max: { N: 512, dz: 0.25, K: 13 },
  // vista de máxima calidad: una fila por capa de impresión y tantas columnas
  // como quepan en el presupuesto de triángulos (ver resolveQuality)
  ultra: { N: 576, dz: 0.2, K: 13, budget: 6e6 },
  ultraLite: { N: 400, dz: 0.3, K: 11, budget: 1.5e6 },
};

// ── Impresora: boquilla, altura de capa y ancho de línea ───────────────────
export const NOZZLES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];
export function printOf(P) {
  const nozzle = NOZZLES.includes(+P.nozzle) ? +P.nozzle : 0.4;
  const ratio = Math.min(0.75, Math.max(0.25, +P.layerRatio || 0.5));
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    nozzle,
    layer: r2(nozzle * ratio), // altura de capa
    line: r2(nozzle * 1.1), // ancho de línea normal
    vaseLine: r2(nozzle * 1.5), // en modo vaso, una sola línea ancha
  };
}

// Las calidades con presupuesto ponen una fila por capa real y reparten los
// triángulos que quedan en columnas: es la malla más fina que tiene sentido,
// porque la impresora no puede dibujar nada más pequeño que una capa.
export function resolveQuality(qname, P) {
  const Q = { ...(QUALITY[qname] || QUALITY.preview) };
  if (!Q.budget) return Q;
  const span = 2 * P.height + 2 * (P.kind === 'jar' ? jarLid(P) : Math.min(P.resHeight, P.height - 25));
  let dz = Math.max(0.05, printOf(P).layer);
  const nMin = 288, nMax = 1024;
  if ((span / dz) * 2 * nMin > Q.budget) dz = (span * 2 * nMin) / Q.budget;
  Q.dz = dz;
  Q.N = Math.max(nMin, Math.min(nMax, Math.floor(Q.budget / ((span / dz) * 2) / 16) * 16));
  return Q;
}

const TAU = Math.PI * 2;
const jarLid = (P) => Math.max(8, Math.min(+P.lidHeight || 22, P.height * 0.6));
const fract = (x) => x - Math.floor(x);
const smooth = (a, b, x) => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

function profileFn(P) {
  const H = P.height, sb = P.baseScale, bulge = P.bulge;
  const g = {
    linear: (u) => u,
    bowl: (u) => 1 - (1 - u) * (1 - u),
    flare: (u) => u * u,
    s: (u) => u * u * (3 - 2 * u),
  }[P.profile] || ((u) => u);
  return (z) => {
    const u = Math.min(1, Math.max(0, z / H));
    return sb + (1 - sb) * g(u) + bulge * Math.sin(Math.PI * u);
  };
}

function rimDropFn(P, twistTop) {
  const n = Math.max(1, Math.round(P.rimCount)), A = P.rimAmp;
  const base = -Math.PI / 2 + (P.shape === 'poly' ? Math.PI / Math.max(3, Math.round(P.sides)) : 0);
  const ph = (P.rimPhase * Math.PI) / 180;
  return (th) => {
    const x = fract(((th - twistTop - base - ph) / TAU) * n);
    switch (P.rimStyle) {
      case 'wave': return A * (0.5 - 0.5 * Math.cos(TAU * x));
      case 'scallop': { const y = 2 * fract(x + 0.5) - 1; return A * (1 - Math.sqrt(Math.max(0, 1 - y * y))); }
      case 'crown': return A * Math.pow(Math.abs(2 * fract(x + 0.5) - 1), 0.85);
      default: return 0;
    }
  };
}

const polyArea = (rs, N) => {
  let a = 0;
  for (let j = 0; j < N; j++) a += rs[j] * rs[(j + 1) % N];
  return 0.5 * a * Math.sin(TAU / N);
};

// Forma base O(θ, z) en una rejilla global, ya limitada al voladizo máximo, y
// su desplazada hacia dentro un grosor de pared.
function baseGrid(P, N, k, t) {
  const H = P.height;
  const LUT = buildSectionLUT(P);
  const ML = LUT.length;
  const lut = (th) => {
    let x = (th / TAU) * ML;
    x = ((x % ML) + ML) % ML;
    const i = Math.floor(x), f = x - i;
    return LUT[i] * (1 - f) + LUT[(i + 1) % ML] * f;
  };
  const twTot = (P.twist * Math.PI) / 180;
  const twist = P.twistMode === 'wave' ? (z) => twTot * Math.sin((Math.PI * z) / H) : (z) => (twTot * z) / H;
  const sProf = profileFn(P);

  const R = Math.ceil(H / 0.5) + 1;
  const dzG = H / (R - 1);
  const Og = new Float64Array(R * N), Oin = new Float64Array(R * N);
  for (let r = 0; r < R; r++) {
    const z = r * dzG, s = sProf(z), tw = twist(z);
    for (let j = 0; j < N; j++) Og[r * N + j] = s * lut((TAU * j) / N - tw);
  }
  {
    const kd = k * dzG;
    for (let j = 0; j < N; j++) {
      for (let r = 1; r < R; r++) {
        const prev = Og[(r - 1) * N + j];
        const v = Og[r * N + j];
        Og[r * N + j] = Math.min(prev + kd, Math.max(prev - kd, v));
      }
    }
  }
  {
    const row = new Float64Array(N), out = new Float64Array(N), tx = new Float64Array(N), ty = new Float64Array(N);
    for (let r = 0; r < R; r++) {
      for (let j = 0; j < N; j++) row[j] = Og[r * N + j];
      offsetRow(row, t, out, tx, ty);
      for (let j = 0; j < N; j++) Oin[r * N + j] = Math.min(out[j], row[j] - t * 0.9);
    }
  }
  const gridAt = (G) => (j, z) => {
    let x = z / dzG;
    if (x < 0) x = 0; else if (x > R - 1) x = R - 1;
    const r = Math.min(R - 2, Math.floor(x)), f = x - r;
    return G[r * N + j] * (1 - f) + G[(r + 1) * N + j] * f;
  };
  const Oat = gridAt(Og), OinAt = gridAt(Oin);
  return { twist, R, dzG, Og, Oin, Oat, OinAt };
}

export function build(P, qname = 'preview') {
  if (P.kind === 'jar') return buildJar(P, qname);
  const Q = resolveQuality(qname, P);
  const N = Q.N;
  const H = P.height;
  const k = Math.tan(((P.maxOverhang - 3) * Math.PI) / 180);
  // Modo vaso: cada pieza es una sola línea continua en espiral. La pared mide
  // un ancho de línea y sigue a la cara exterior; no hay rosca ni borde
  // decorado, y el reservorio acaba en un aro circular plano donde se apoya el
  // cono de la maceta (por contacto, sin holgura que ajustar).
  const pr = printOf(P);
  const vase = !!P.vase;
  const t = vase ? pr.vaseLine : P.wall, fT = P.floor, c = vase ? 0.05 : P.fit, g = P.waterGap;
  const e = vase ? t : Math.max(0.8, t * 0.45);
  const warnings = [];

  const { twist, R, dzG, Oin, Oat, OinAt } = baseGrid(P, N, k, t);

  // ── Encaje maceta ↔ reservorio ───────────────────────────────────────────
  let resH = Math.min(P.resHeight, H - 25);
  let minOin = Infinity;
  for (let r = 0; r < R; r++) {
    const z = r * dzG;
    if (z < fT || z > resH + 2) continue;
    for (let j = 0; j < N; j++) minOin = Math.min(minOin, Oin[r * N + j]);
  }
  const cDil = c * Math.sqrt(1 + k * k);
  const drop = cDil / k; // lo que baja la maceta hasta tocar el cono
  let OminH = Infinity;
  for (let j = 0; j < N; j++) OminH = Math.min(OminH, Oat(j, resH));
  // Rosca: dientes trapeciales con flancos a pendiente k (imprimibles por fuera
  // en la maceta y por dentro en el reservorio). Con rosca, las dos bases son
  // planas: la maceta lleva suelo plano y mecha de cuerda.
  const thread = P.joint === 'thread' && !vase;
  const wick = thread ? 'rope' : P.wick;
  const thP = P.threadPitch, thS = Math.max(1, Math.round(P.threadStarts));
  const thFl = 0.38; // fracción del paso que ocupa cada flanco
  const thH = k * thFl * thP; // profundidad del diente
  // rLow: cuerpo de la maceta que baja al agua. rIns: parte encajada, donde
  // nace el cono de asiento (y va la rosca). Sin rosca son iguales.
  const rLow0 = minOin - g;
  let rIns = rLow0, gSeat = g;
  if (thread) {
    // La rosca va pegada a la pared a su altura, y la hembra es maciza contra
    // ella: si quedara hueco detrás, sería un compartimento cerrado por abajo
    // (la hembra tiene que nacer de la pared para imprimirse sin soportes) y
    // el agua no llegaría. Tramo estimado por lo bajo con el asiento sin rosca.
    const zLo = Math.max(fT, resH - (OminH - e - cDil - rLow0) / k - P.threadLen - drop - 4);
    let mnT = Infinity;
    for (let r = 0; r < R; r++) {
      const z = r * dzG;
      if (z < zLo || z > resH + 2) continue;
      for (let j = 0; j < N; j++) mnT = Math.min(mnT, Oin[r * N + j]);
    }
    rIns = mnT - (thH + cDil + 0.4);
    gSeat = mnT - rIns;
  }
  const rLow = Math.min(rLow0, rIns);
  let za = resH - (OminH - e - cDil - rIns) / k;
  if (za < fT + 10) {
    warnings.push({ level: 'warn', text: 'El reservorio es muy bajo para esta forma: se ha subido la unión.' });
    za = fT + 10;
  }

  // Sistema de riego
  let zpb, zft, rf, zwTop;
  if (wick === 'cone') {
    zpb = fT + 1.5;
    zft = zpb + fT + 3;
    rf = Math.min(P.footDia / 2, rIns - 2);
    zwTop = zft + (rIns - rf) / k;
    if (zwTop > za - 1) {
      zwTop = za - 1;
      rf = rIns - k * (zwTop - zft);
      warnings.push({ level: 'info', text: `Pie del cono ensanchado a Ø${(rf * 2).toFixed(0)} mm para que quepa en el reservorio.` });
    }
  } else {
    // con rosca, el tramo roscado va entre el suelo y el cono de asiento
    zpb = Math.max(fT + 5, Math.min(fT + P.waterDepth, za - 3 - (thread ? P.threadLen + 1 : 0)));
    if (zpb < fT + P.waterDepth - 0.5) warnings.push({ level: 'info', text: 'Profundidad de agua limitada por la altura de la unión.' });
    rf = rIns; zft = zpb; zwTop = zpb;
  }

  // Tramo roscado [thBot, thTop] de la maceta, justo bajo el cono de asiento.
  // El cono sigue siendo el tope: al apretar, la maceta baja `drop` hasta
  // tocarlo, así que la rosca hembra va desplazada eso para quedar centrada.
  const thTop = za - 1, thBot = Math.max(zpb + 1, thTop - P.threadLen);
  const thLen = thread ? thTop - thBot : 0;
  if (thread && thLen < P.threadLen - 0.5) warnings.push({ level: thLen < thP * 1.5 ? 'warn' : 'info', text: `Rosca acortada a ${thLen.toFixed(0)} mm: sube la unión para alargarla.` });
  const tooth = (u) => {
    u -= Math.floor(u);
    const a = 0.5 - thFl; // meseta de cresta y de raíz
    if (u < thFl) return u / thFl;
    if (u < thFl + a) return 1;
    if (u < 2 * thFl + a) return 1 - (u - thFl - a) / thFl;
    return 0;
  };
  const phase = (th, z) => z / thP - (thS * th) / TAU; // hélice a derechas
  // diente macho: lo que sobresale de rIns, con entradas a pendiente k
  const threadPot = (th, z) => {
    if (!thread || z < thBot || z > thTop) return 0;
    return Math.max(0, Math.min(thH * tooth(phase(th, z)), k * (z - thBot), k * (thTop - z)));
  };
  // Superficie de la rosca hembra (radio interior del reservorio). Por debajo
  // y por encima se abre a pendiente k hasta la pared: es un anillo macizo que
  // nace de la pared, sin ningún hueco detrás.
  const fBot = thBot - drop, fTop = thTop - drop, rF0 = rIns + cDil;
  const threadRes = (th, z) => {
    if (!thread) return Infinity;
    return Math.max(rF0 + thH * tooth(phase(th, z + drop)), rF0 + thH + k * (fBot - z), rF0 + thH + k * (z - fTop));
  };

  // Con rosca, bajo el tramo roscado la maceta se estrecha a pendiente k hasta
  // rLow (su cara de fuera se abre al subir: imprimible).
  const zNeck = thBot - 0.5;
  const seatPot = (z) => {
    if (z >= za) return rIns + k * (z - za);
    if (z >= zwTop) return thread ? Math.max(rLow, Math.min(rIns, rIns - k * (zNeck - z))) : rIns;
    if (z >= zft) return rf + k * (z - zft);
    return rf;
  };
  if (thread) rf = seatPot(zpb);

  // Desplazamientos del perfil circular: interior de la maceta (−t) y
  // asiento del reservorio (+holgura), como erosión/dilatación por un disco.
  const z0L = zpb - 3, stL = 0.1, nL = Math.ceil((H + 6 - z0L) / stL) + 1;
  const potInL = new Float64Array(nL), resInL = new Float64Array(nL);
  for (let i = 0; i < nL; i++) {
    const z = z0L + i * stL;
    let mn = Infinity, mx = -Infinity;
    for (let s = -10; s <= 10; s++) {
      const dz = (t * s) / 10;
      mn = Math.min(mn, seatPot(z + dz) - Math.sqrt(Math.max(0, t * t - dz * dz)));
      const dc = (c * s) / 10;
      mx = Math.max(mx, seatPot(z + dc) + Math.sqrt(Math.max(0, c * c - dc * dc)));
    }
    potInL[i] = mn; resInL[i] = mx;
  }
  const lz = (L) => (z) => {
    let x = (z - z0L) / stL;
    if (x < 0) x = 0; else if (x > nL - 1) x = nL - 1;
    const i = Math.min(nL - 2, Math.floor(x)), f = x - i;
    return L[i] * (1 - f) + L[i + 1] * f;
  };
  const potIn = lz(potInL), resIn = lz(resInL);

  const solveUp = (fn, z0, zMax) => {
    let z = z0;
    while (z < zMax && fn(z) < 0) z += 0.25;
    let a = Math.max(z0, z - 0.25), b = z;
    for (let i = 0; i < 10; i++) { const m = (a + b) / 2; if (fn(m) < 0) a = m; else b = m; }
    return b;
  };

  const zTop = new Float64Array(N), zTopEff = new Float64Array(N), zv = new Float64Array(N), zRim = new Float64Array(N);
  const rimDrop = vase ? () => 0 : rimDropFn(P, twist(H));
  let zTopMax = 0, zTopMin = Infinity;
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N;
    zTop[j] = vase ? resH : solveUp((z) => resIn(z) - (Oat(j, z) - e), za, H - 4);
    zv[j] = solveUp((z) => seatPot(z) - Oat(j, z), za, H);
    zTopEff[j] = zTop[j];
    zRim[j] = H - rimDrop(th);
    zTopMax = Math.max(zTopMax, zTop[j]);
    zTopMin = Math.min(zTopMin, zTop[j]);
  }
  const resWall = (j, z) => Math.max(OinAt(j, z), resIn(z));
  if (zTopMax > H - 12) warnings.push({ level: 'error', text: 'La unión queda casi en el borde: baja el reservorio o reduce el giro/forma.' });
  let zRimMin = Infinity;
  for (let j = 0; j < N; j++) zRimMin = Math.min(zRimMin, zRim[j]);
  if (zRimMin < zTopMax + 8) warnings.push({ level: 'warn', text: 'El borde decorativo baja casi hasta la unión.' });

  // ── Patrones ─────────────────────────────────────────────────────────────
  const ctx = { rref: P.width / 2, twist };
  const potPat = makePattern(P.pot, ctx);
  const resPat = makePattern(P.linkPatterns ? P.pot : P.res, ctx);
  const fade = 2.5;
  const wPot = (j, z) => smooth(zv[j] + P.bandSeam, zv[j] + P.bandSeam + fade, z) * smooth(zRim[j] - P.bandRim, zRim[j] - P.bandRim - fade, z);
  const wRes = (j, z) => smooth(P.bandBase, P.bandBase + fade, z) * smooth(zTopEff[j] - P.bandSeam, zTopEff[j] - P.bandSeam - fade, z);

  const ch = P.chamfer;
  const K = Q.K;

  // ── Maceta ───────────────────────────────────────────────────────────────
  const potMo = Math.max(24, Math.ceil((H - zpb) / Q.dz));
  const potMi = potMo;
  const potPc = potMo + K + potMi;
  const potRr = new Float64Array(N * potPc), potZz = new Float64Array(N * potPc);
  const riTmp = new Float64Array(potMi), ziTmp = new Float64Array(potMi);
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N;
    const zr = zRim[j];
    const base = j * potPc;
    const roTop0 = Math.min(Oat(j, zr), seatPot(zr));
    const riTop0 = Math.min(OinAt(j, zr), potIn(zr));
    const rr = P.rimRound && !vase ? Math.max(0, (roTop0 - riTop0) / 2) : 0;
    const zo1 = zr - rr;
    const dzo = (zo1 - zpb) / (potMo - 1);
    let prev = 0;
    for (let q = 0; q < potMo; q++) {
      const z = zpb + dzo * q;
      let r = Oat(j, z) + (potPat ? potPat(th, z) * wPot(j, z) : 0);
      r = Math.min(r, seatPot(z)) + threadPot(th, z);
      if (q > 0) r = Math.min(r, prev + k * dzo);
      // en vaso la cara de dentro copia a la de fuera: tampoco puede cerrarse deprisa
      if (vase && q > 0) r = Math.max(r, prev - k * dzo);
      prev = r;
      const dzb = z - zpb;
      potRr[base + q] = dzb < ch ? r - (ch - dzb) : r;
      potZz[base + q] = z;
    }
    if (vase) continue; // el interior se saca luego, fila a fila, de la cara exterior
    // interior: de arriba (zo1) al suelo, limitado de abajo arriba
    const zf = zpb + fT;
    const dzi = (zo1 - zf) / (potMi - 1);
    for (let q = 0; q < potMi; q++) {
      const z = zo1 - dzi * q;
      ziTmp[q] = z;
      riTmp[q] = Math.min(OinAt(j, z), potIn(z));
    }
    for (let q = potMi - 2; q >= 0; q--) riTmp[q] = Math.max(riTmp[q], riTmp[q + 1] - k * dzi);
    for (let q = 0; q < potMi; q++) {
      const z = ziTmp[q];
      const lim = Math.min(Oat(j, z), seatPot(z)) - t * 0.5;
      riTmp[q] = Math.min(riTmp[q], lim);
    }
    // borde (semicírculo o plano)
    const roL = potRr[base + potMo - 1], riF = riTmp[0];
    for (let q = 0; q < K; q++) {
      const a = (Math.PI * (q + 1)) / (K + 1);
      if (rr > 0) {
        potRr[base + potMo + q] = (roL + riF) / 2 + ((roL - riF) / 2) * Math.cos(a);
        potZz[base + potMo + q] = zo1 + rr * Math.sin(a);
      } else {
        const f = (q + 1) / (K + 1);
        potRr[base + potMo + q] = roL + (riF - roL) * f;
        potZz[base + potMo + q] = zo1;
      }
    }
    for (let q = 0; q < potMi; q++) {
      potRr[base + potMo + K + q] = riTmp[q];
      potZz[base + potMo + K + q] = ziTmp[q];
    }
  }

  // agujeros del suelo de la maceta
  const holes = [];
  const floorInR = rf - t; // radio útil del suelo
  if (wick === 'cone') {
    const hr = P.holeDia / 2;
    const ring = Math.max(hr * 2 + 1.2, (floorInR - hr - 1.2) * 0.62);
    holes.push({ x: 0, y: 0, r: hr });
    if (ring + hr < floorInR - 1) {
      const n = Math.max(0, Math.min(P.holeCount, Math.floor((TAU * ring) / (hr * 2 + 2))));
      for (let i = 0; i < n; i++) holes.push({ x: ring * Math.cos((TAU * i) / n + Math.PI / n), y: ring * Math.sin((TAU * i) / n + Math.PI / n), r: hr });
    }
  } else {
    holes.push({ x: 0, y: 0, r: P.ropeDia / 2 });
    const hr = P.holeDia / 2;
    const ring = Math.max(P.ropeDia / 2 + hr + 4, floorInR * 0.62);
    if (ring + hr < floorInR - 1.5) {
      const n = Math.max(0, Math.min(P.holeCount, Math.floor((TAU * ring) / (hr * 2 + 3))));
      for (let i = 0; i < n; i++) holes.push({ x: ring * Math.cos((TAU * i) / n), y: ring * Math.sin((TAU * i) / n), r: hr });
    }
  }
  if (vase) vaseInner(potRr, potZz, N, potPc, potMo, K, potMi, zpb + fT, t);
  const potMesh = assemble(N, potPc, potRr, potZz, holes, potMo, K);

  // ── Reservorio ───────────────────────────────────────────────────────────
  // Muestrea una pared interior de zHi a zLo (n puntos, de arriba abajo) y la
  // limita: al subir no se cierra más deprisa que k y deja pared hasta `lim`.
  const innerSeg = (rr, zz, o, zHi, zLo, n, fn, lim) => {
    const d = (zHi - zLo) / (n - 1);
    for (let q = 0; q < n; q++) { const z = zHi - d * q; rr[o + q] = fn(z); zz[o + q] = z; }
    for (let q = n - 2; q >= 0; q--) rr[o + q] = Math.max(rr[o + q], rr[o + q + 1] - k * d);
    for (let q = 0; q < n; q++) rr[o + q] = Math.min(rr[o + q], lim(zz[o + q]));
  };
  // Interior del reservorio de zHi a zLo en n puntos (con rosca, la hembra).
  const resCounts = (zLo) => [Math.max(16, Math.ceil((zTopMax - zLo) / Q.dz))];
  const resInner = (j, th, zHi, zLo, n, rr, zz) => {
    const lim = (z) => Oat(j, z) - 0.5 * Math.min(t, e);
    innerSeg(rr, zz, 0, zHi, zLo, n[0], (z) => Math.min(resWall(j, z), threadRes(th, z)), lim);
  };

  let zEffMax = 0;
  for (let j = 0; j < N; j++) zEffMax = Math.max(zEffMax, zTopEff[j]);
  const resMo = Math.max(16, Math.ceil(zEffMax / Q.dz));
  const resN = resCounts(fT);
  const resMi = resN.reduce((a, b) => a + b, 0);
  const resPc = resMo + K + resMi;
  const resRr = new Float64Array(N * resPc), resZz = new Float64Array(N * resPc);
  const rrTmp = new Float64Array(resMi), rzTmp = new Float64Array(resMi);
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N;
    const zt = zTopEff[j];
    const base = j * resPc;
    const dzo = zt / (resMo - 1);
    let prev = 0;
    for (let q = 0; q < resMo; q++) {
      const z = dzo * q;
      let r = Oat(j, z) + (resPat ? resPat(th, z) * wRes(j, z) : 0);
      // en vaso, la pared se recoge a pendiente k hasta un aro circular
      if (vase) r = Math.min(r, OminH + k * (zt - z));
      if (q > 0) r = Math.min(r, prev + k * dzo);
      if (vase && q > 0) r = Math.max(r, prev - k * dzo);
      prev = r;
      resRr[base + q] = z < ch ? r - (ch - z) : r;
      resZz[base + q] = z;
    }
    if (vase) continue;
    resInner(j, th, zt, fT, resN, rrTmp, rzTmp);
    const roL = resRr[base + resMo - 1], riF = rrTmp[0];
    for (let q = 0; q < K; q++) {
      const f = (q + 1) / (K + 1);
      resRr[base + resMo + q] = roL + (riF - roL) * f;
      resZz[base + resMo + q] = zt;
    }
    for (let q = 0; q < resMi; q++) {
      resRr[base + resMo + K + q] = rrTmp[q];
      resZz[base + resMo + K + q] = rzTmp[q];
    }
  }
  if (vase) vaseInner(resRr, resZz, N, resPc, resMo, K, resMi, fT, t);
  const resMesh = assemble(N, resPc, resRr, resZz, [], resMo, K);

  // ── Cifras ───────────────────────────────────────────────────────────────
  const rowR = new Float64Array(N);
  const riRes = vase
    ? (j, z) => Math.min(OinAt(j, z), OminH - t + k * (resH - z))
    : (j, z) => Math.max(OinAt(j, z), resIn(z));
  const level = wick === 'cone' ? Math.min(zwTop, za) : zpb - 1;
  let water = 0;
  for (let z = fT + 0.5; z < level; z += 1) {
    for (let j = 0; j < N; j++) rowR[j] = riRes(j, z);
    let a = polyArea(rowR, N);
    if (z >= zpb) a -= Math.PI * seatPot(z) ** 2;
    water += Math.max(0, a) * Math.min(1, level - z + 0.5);
  }
  let soil = 0;
  for (let z = zpb + fT + 0.5; z < zRimMin - 12; z += 1) {
    for (let j = 0; j < N; j++) rowR[j] = Math.min(OinAt(j, z), potIn(z));
    soil += polyArea(rowR, N);
  }

  const potStats = meshStats(potMesh, P.maxOverhang, zpb);
  const resStats = meshStats(resMesh, P.maxOverhang, 0);

  // Agua (solo para la vista en corte)
  const waterMesh = buildWater(N, fT, level, zpb, riRes, seatPot);

  // ── Probeta de encaje ────────────────────────────────────────────────────
  // Dos aros con solo la zona del cono de cada pieza, con los mismos conos que
  // las piezas reales, para probar el ajuste gastando poco filamento. El aro de
  // la maceta empieza 3 mm por encima del del reservorio para que, al apoyarse
  // en el cono, no toque la mesa.
  // `inner(j, th, z1, ri, rz)` rellena la pared interior de arriba abajo en Mi puntos.
  const ring = vase ? null : (...a) => makeRing({ N, K, dz: Q.dz, k, ch }, ...a);
  // el cono del reservorio empieza donde su asiento supera la pared normal;
  // con rosca, el aro baja hasta incluir el tramo roscado
  const zSeat = za + Math.max(0, gSeat - cDil) / k;
  const cPotZ0 = Math.max(zpb, Math.min(zSeat, thread ? thBot : Infinity) - 1);
  const cResZ0 = cPotZ0 - 3;
  // sin patrón: el ajuste depende solo de los conos (y de la rosca, si la hay)
  const cPotOut = (j, th, z) => Math.min(Oat(j, z), seatPot(z)) + threadPot(th, z);
  let cPotTop = 0;
  for (let j = 0; j < N; j++) cPotTop = Math.max(cPotTop, Math.min(zRim[j] - 3, zv[j] + 3));
  const cPotMi = Math.max(8, Math.ceil((cPotTop - cPotZ0) / Q.dz));
  const couponPot = vase ? null : ring(
    cPotZ0,
    (j) => Math.min(zRim[j] - 3, zv[j] + 3),
    cPotOut,
    cPotMi,
    (j, th, z1, ri, rz) => innerSeg(ri, rz, 0, z1, cPotZ0, cPotMi, (z) => Math.min(OinAt(j, z), potIn(z)), (z) => cPotOut(j, th, z) - 0.5 * Math.min(t, e)),
  );
  const cResN = resCounts(cResZ0);
  const couponRes = vase ? null : ring(
    cResZ0,
    (j) => zTopEff[j],
    (j, th, z) => Oat(j, z),
    cResN.reduce((a, b) => a + b, 0),
    (j, th, z1, ri, rz) => resInner(j, th, z1, cResZ0, cResN, ri, rz),
  );
  const cPotStats = vase ? null : meshStats(couponPot, P.maxOverhang, 0), cResStats = vase ? null : meshStats(couponRes, P.maxOverhang, 0);

  const potH = H - zpb;
  const fits = (s, h) => s.size[0] <= BED.x - 4 && s.size[1] <= BED.y - 4 && h <= BED.z;
  const info = {
    pot: { ...potStats.info, height: potH, fits: fits(potStats.info, potH) },
    res: { ...resStats.info, height: zEffMax, fits: fits(resStats.info, zEffMax) },
    kind: 'planter', totalH: H,
    waterMl: water / 1000,
    soilL: soil / 1e6,
    level, zpb, za, rIns, rf, zTopMin, zTopMax, footDia: rf * 2,
    holes: holes.length, wick,
    thread: thread ? { pitch: thP, starts: thS, depth: thH, length: thLen, turns: thLen / (thP * thS) } : null,
    print: {
      ...pr, vase, wall: t,
      // en modo normal, cuántas líneas caben en la pared
      perimeters: vase ? 1 : Math.max(1, Math.round(t / pr.line)),
      layersPot: Math.ceil(potH / pr.layer), layersRes: Math.ceil(zEffMax / pr.layer),
    },
    coupon: vase ? null : {
      grams: cPotStats.info.grams + cResStats.info.grams,
      pot: { height: cPotStats.info.size[2], grams: cPotStats.info.grams },
      res: { height: cResStats.info.size[2], grams: cResStats.info.grams },
      // al apoyarse, el aro de la maceta queda por encima de la mesa
      clearance: cPotZ0 - cResZ0,
      drop: cDil / k, // lo que baja la maceta hasta tocar el cono
    },
  };
  if (!vase && t < pr.line * 0.95) warnings.push({ level: 'warn', text: `La pared (${t.toFixed(1).replace('.', ',')} mm) es más fina que una línea de la boquilla de ${String(pr.nozzle).replace('.', ',')} (${String(pr.line).replace('.', ',')} mm): súbela o no saldrá.` });
  if (vase && P.floor < pr.layer * 2) warnings.push({ level: 'info', text: 'El suelo tiene menos de dos capas: súbelo para que sea estanco.' });
  if (!info.pot.fits) warnings.push({ level: 'error', text: `La maceta no cabe en la ${BED.name} (220×220×250).` });
  if (!info.res.fits) warnings.push({ level: 'error', text: `El reservorio no cabe en la ${BED.name}.` });
  if (info.waterMl < 80) warnings.push({ level: 'warn', text: 'Poca reserva de agua: sube el reservorio o amplía la holgura de agua.' });
  if (potStats.islands || resStats.islands) warnings.push({ level: 'error', text: 'Hay partes que empiezan en el aire: necesitarían soportes.' });
  if (potStats.overhangArea > 40 || resStats.overhangArea > 40) {
    warnings.push({ level: 'error', text: 'Hay zonas con voladizo: actívalas en "Ver voladizos".' });
  }

  return {
    pot: potMesh, res: resMesh, water: waterMesh,
    coupon: vase ? null : { pot: couponPot, res: couponRes },
    overhang: { pot: potStats.over, res: resStats.over },
    overhangArea: { pot: potStats.overhangArea, res: resStats.overhangArea },
    islands: { pot: potStats.islands, res: resStats.islands, coupon: vase ? 0 : cPotStats.islands + cResStats.islands },
    info, warnings,
  };
}

// Aro con el perfil exterior `outerF` de z0 a z1f(j) y la pared interior que
// rellena `inner(j, th, z1, ri, rz)` de arriba abajo en Mi puntos.
function makeRing({ N, K, dz: dzQ, k, ch }, z0, z1f, outerF, Mi, inner) {
  let zmax = 0;
  for (let j = 0; j < N; j++) zmax = Math.max(zmax, z1f(j));
  const M = Math.max(8, Math.ceil((zmax - z0) / dzQ));
  const Pc = M + Mi + 2 * K;
  const Rr = new Float64Array(N * Pc), Zz = new Float64Array(N * Pc);
  const ri = new Float64Array(Mi), rz = new Float64Array(Mi);
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N, z1 = z1f(j), dz = (z1 - z0) / (M - 1), base = j * Pc;
    let prev = 0;
    for (let q = 0; q < M; q++) {
      const z = z0 + dz * q;
      let r = outerF(j, th, z);
      if (q > 0) r = Math.min(r, prev + k * dz);
      prev = r;
      Rr[base + q] = z - z0 < ch ? r - (ch - (z - z0)) : r;
      Zz[base + q] = z;
    }
    inner(j, th, z1, ri, rz);
    const roT = Rr[base + M - 1], roB = Rr[base];
    for (let q = 0; q < K; q++) {
      const f = (q + 1) / (K + 1);
      Rr[base + M + q] = roT + (ri[0] - roT) * f; Zz[base + M + q] = z1;
      Rr[base + M + K + Mi + q] = ri[Mi - 1] + (roB - ri[Mi - 1]) * f; Zz[base + M + K + Mi + q] = z0;
    }
    for (let q = 0; q < Mi; q++) { Rr[base + M + K + q] = ri[q]; Zz[base + M + K + q] = rz[q]; }
  }
  return assembleRing(N, Pc, Rr, Zz, -z0);
}

// Une columnas de perfiles en una malla cerrada.
// `across` (solo para dibujar): en el canto superior, la distancia en mm a la
// cara exterior, para pintar las líneas de perímetro; −1 en suelos y bases,
// que se pintan con líneas rectas de relleno.
function assemble(N, Pc, Rr, Zz, holes, Mo, K) {
  const HS = 20;
  const nv = N * Pc + holes.length * HS * 2;
  const pos = new Float32Array(nv * 3);
  const across = new Float32Array(nv).fill(-1);
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N, cs = Math.cos(th), sn = Math.sin(th);
    const ro = Rr[j * Pc + Mo - 1];
    for (let q = 0; q < Pc; q++) {
      const i = j * Pc + q;
      pos[i * 3] = Rr[i] * cs; pos[i * 3 + 1] = Rr[i] * sn; pos[i * 3 + 2] = Zz[i];
      if (q > 0 && q < Pc - 1) across[i] = q < Mo ? 0 : Math.abs(ro - Rr[j * Pc + Math.min(q, Mo + K)]);
    }
  }
  const capTris = (N + holes.length * HS) * 2 + holes.length * 4 + 16;
  const idx = new Uint32Array((N * (Pc - 1) * 2 + capTris + holes.length * HS * 2) * 3);
  let ni = 0;
  const push3 = (a, b, cc) => { idx[ni++] = a; idx[ni++] = b; idx[ni++] = cc; };
  for (let j = 0; j < N; j++) {
    const j1 = (j + 1) % N;
    for (let q = 0; q < Pc - 1; q++) {
      const a = j * Pc + q, b = j1 * Pc + q, cc = j1 * Pc + q + 1, d = j * Pc + q + 1;
      push3(a, b, cc); push3(a, cc, d);
    }
  }
  // vértices de los agujeros
  const zBot = Zz[0], zFloor = Zz[Pc - 1];
  let hv = N * Pc;
  const holeB = [], holeT = [];
  for (const h of holes) {
    const b = [], tp = [];
    for (let i = 0; i < HS; i++) {
      const a = (TAU * i) / HS;
      const x = h.x + h.r * Math.cos(a), y = h.y + h.r * Math.sin(a);
      pos[hv * 3] = x; pos[hv * 3 + 1] = y; pos[hv * 3 + 2] = zBot; b.push(hv++);
      pos[hv * 3] = x; pos[hv * 3 + 1] = y; pos[hv * 3 + 2] = zFloor; tp.push(hv++);
    }
    holeB.push(b); holeT.push(tp);
  }
  const cap = (ringIdx, holeRings, up) => {
    const v2 = (i) => new Vector2(pos[i * 3], pos[i * 3 + 1]);
    const contour = ringIdx.map(v2);
    const hs = holeRings.map((r) => r.map(v2));
    const map = ringIdx.concat(...holeRings);
    const tris = ShapeUtils.triangulateShape(contour, hs);
    for (const [a, b, cc] of tris) {
      const A = map[a], B = map[b], C = map[cc];
      const cr = (pos[B * 3] - pos[A * 3]) * (pos[C * 3 + 1] - pos[A * 3 + 1]) - (pos[B * 3 + 1] - pos[A * 3 + 1]) * (pos[C * 3] - pos[A * 3]);
      if ((cr > 0) === up) push3(A, B, C); else push3(A, C, B);
    }
  };
  const ring0 = [], ringL = [];
  for (let j = 0; j < N; j++) { ring0.push(j * Pc); ringL.push(j * Pc + Pc - 1); }
  cap(ring0, holeB, false);
  cap(ringL, holeT, true);
  for (let h = 0; h < holes.length; h++) {
    const B = holeB[h], T = holeT[h];
    for (let i = 0; i < HS; i++) {
      const i1 = (i + 1) % HS;
      push3(B[i], T[i], T[i1]); push3(B[i], T[i1], B[i1]);
    }
  }
  return { positions: pos, indices: idx.slice(0, ni), across };
}

// Modo vaso: la cara interior es la exterior desplazada un ancho de línea,
// fila a fila (todas las columnas comparten alturas porque el borde es plano).
function vaseInner(Rr, Zz, N, Pc, Mo, K, Mi, zLo, w) {
  const row = new Float64Array(N), out = new Float64Array(N), tx = new Float64Array(N), ty = new Float64Array(N);
  const z0 = Zz[0], zHi = Zz[Mo - 1], dzo = (zHi - z0) / (Mo - 1);
  for (let q = 0; q < Mi; q++) {
    const z = zHi - ((zHi - zLo) * q) / (Mi - 1);
    const x = (z - z0) / dzo;
    const i = Math.min(Mo - 2, Math.max(0, Math.floor(x))), f = x - i;
    for (let j = 0; j < N; j++) row[j] = Rr[j * Pc + i] * (1 - f) + Rr[j * Pc + i + 1] * f;
    offsetRow(row, w, out, tx, ty);
    for (let j = 0; j < N; j++) {
      Rr[j * Pc + Mo + K + q] = Math.min(out[j], row[j] - 0.6 * w);
      Zz[j * Pc + Mo + K + q] = z;
    }
  }
  for (let j = 0; j < N; j++) {
    const b = j * Pc, roL = Rr[b + Mo - 1], riF = Rr[b + Mo + K];
    for (let q = 0; q < K; q++) {
      Rr[b + Mo + q] = roL + ((riF - roL) * (q + 1)) / (K + 1);
      Zz[b + Mo + q] = zHi;
    }
  }
}

// Normales por vértice ponderadas por área (se calculan en el trabajador para
// no parar la interfaz con mallas de millones de triángulos).
export function vertexNormals(m) {
  const p = m.positions, ix = m.indices, n = new Float32Array(p.length);
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

// Aro cerrado: el perfil de cada columna es un bucle (fuera, canto, dentro, base).
function assembleRing(N, Pc, Rr, Zz, dz) {
  const pos = new Float32Array(N * Pc * 3);
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N, cs = Math.cos(th), sn = Math.sin(th);
    for (let q = 0; q < Pc; q++) {
      const i = j * Pc + q;
      pos[i * 3] = Rr[i] * cs; pos[i * 3 + 1] = Rr[i] * sn; pos[i * 3 + 2] = Zz[i] + dz;
    }
  }
  const idx = new Uint32Array(N * Pc * 6);
  let ni = 0;
  for (let j = 0; j < N; j++) {
    const j1 = (j + 1) % N;
    for (let q = 0; q < Pc; q++) {
      const q1 = (q + 1) % Pc;
      const a = j * Pc + q, b = j1 * Pc + q, c = j1 * Pc + q1, d = j * Pc + q1;
      idx[ni++] = a; idx[ni++] = b; idx[ni++] = c;
      idx[ni++] = a; idx[ni++] = c; idx[ni++] = d;
    }
  }
  return { positions: pos, indices: idx };
}

export function meshStats(m, maxOver, zMin) {
  const p = m.positions, ix = m.indices;
  let vol = 0, area = 0, overArea = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[i + a]); mx[a] = Math.max(mx[a], p[i + a]); }
  // una cara inclinada a α de la vertical tiene nz = −sin α
  const thr = -Math.sin((maxOver * Math.PI) / 180) - 0.02;
  const over = [];
  // para detectar partes que empiezan en el aire: el vecino más bajo y la
  // componente z de la normal de cada vértice, ponderada por el ángulo de cada
  // triángulo en ese vértice (no por su área: los triángulos finos del suelo no
  // pueden quedar en minoría frente a la pared)
  const nv = p.length / 3;
  const nbMin = new Float32Array(nv).fill(Infinity), vnz = new Float32Array(nv);
  const ang = (x1, y1, z1, x2, y2, z2) => Math.acos(Math.max(-1, Math.min(1, (x1 * x2 + y1 * y2 + z1 * z2) / (Math.hypot(x1, y1, z1) * Math.hypot(x2, y2, z2) || 1))));
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const ux = p[b] - ax, uy = p[b + 1] - ay, uz = p[b + 2] - az;
    const vx = p[c] - ax, vy = p[c + 1] - ay, vz = p[c + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    vol += (ax * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - ay * (p[b] * p[c + 2] - p[b + 2] * p[c]) + az * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    const ia = ix[i], ib = ix[i + 1], ic = ix[i + 2];
    nbMin[ia] = Math.min(nbMin[ia], p[b + 2], p[c + 2]);
    nbMin[ib] = Math.min(nbMin[ib], az, p[c + 2]);
    nbMin[ic] = Math.min(nbMin[ic], az, p[b + 2]);
    const l = Math.hypot(nx, ny, nz);
    if (l === 0) continue;
    const wx = p[c] - p[b], wy = p[c + 1] - p[b + 1], wz = p[c + 2] - p[b + 2];
    const aA = ang(ux, uy, uz, vx, vy, vz), aB = ang(-ux, -uy, -uz, wx, wy, wz);
    vnz[ia] += (aA * nz) / l; vnz[ib] += (aB * nz) / l; vnz[ic] += ((Math.PI - aA - aB) * nz) / l;
    area += l / 2;
    const cz = (az + p[b + 2] + p[c + 2]) / 3;
    if (nz / l < thr && cz > mn[2] + 1.0) {
      overArea += l / 2;
      over.push(ax, ay, az, p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
    }
  }
  // Una pieza que empieza en el aire es un vértice sin vecinos más bajos, con
  // la normal hacia abajo, por encima de la cama: cada cara puede cumplir el
  // voladizo y aun así necesitar soporte.
  let islands = 0;
  for (let v = 0; v < nv; v++) {
    const z = p[v * 3 + 2];
    if (z > mn[2] + 1 && nbMin[v] >= z - 1e-3 && vnz[v] < -0.3) islands++;
  }
  const fil = 1.75;
  return {
    islands,
    info: {
      size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
      volume: vol,
      grams: (vol / 1000) * 1.24,
      meters: vol / (Math.PI * (fil / 2) ** 2) / 1000,
      tris: ix.length / 3,
    },
    overhangArea: overArea,
    over: new Float32Array(over),
  };
}

function buildWater(N, fT, level, zpb, riRes, seatPot) {
  if (!(level > fT + 1)) return null;
  const pts = (j) => {
    const L = [];
    const S = 8;
    for (let i = 0; i <= S; i++) { const z = fT + 0.2 + ((level - fT - 0.2) * i) / S; L.push([riRes(j, z) - 0.35, z]); }
    if (level > zpb) {
      for (let i = 0; i <= S; i++) { const z = level - ((level - zpb + 0.3) * i) / S; L.push([seatPot(z) + 0.35, z]); }
      L.push([0.01, zpb - 0.3]);
    } else L.push([0.01, level]);
    L.push([0.01, fT + 0.2]);
    return L;
  };
  const cols = [];
  for (let j = 0; j < N; j++) cols.push(pts(j));
  const Pc = cols[0].length;
  const pos = new Float32Array(N * Pc * 3);
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N;
    for (let q = 0; q < Pc; q++) {
      const i = (j * Pc + q) * 3;
      pos[i] = cols[j][q][0] * Math.cos(th); pos[i + 1] = cols[j][q][0] * Math.sin(th); pos[i + 2] = cols[j][q][1];
    }
  }
  const idx = [];
  for (let j = 0; j < N; j++) {
    const j1 = (j + 1) % N;
    for (let q = 0; q < Pc; q++) {
      const q1 = (q + 1) % Pc;
      const a = j * Pc + q, b = j1 * Pc + q, c = j1 * Pc + q1, d = j * Pc + q1;
      idx.push(a, b, c, a, c, d);
    }
  }
  return { positions: pos, indices: new Uint32Array(idx) };
}

// ── Tarro con tapa de rosca ─────────────────────────────────────────────────
// El tarro (pieza `res`) sube con la forma y el patrón hasta la unión; ahí un
// hombro plano entra hasta un cuello circular con rosca macho. La tapa (pieza
// `pot`) sigue la misma forma por fuera, así que montados parecen un solo
// volumen, y lleva la rosca hembra maciza por dentro.
//
// Sin soportes: bajo el hombro, el interior del tarro se cierra en cono a la
// pendiente máxima; los dientes tienen los flancos a esa misma pendiente; y la
// tapa se genera ya boca abajo, apoyada en su cara plana, que es como se
// imprime (`info.flip` dice a qué altura darle la vuelta para verla montada).
//
// Alineación de la tapa: no depende de lo que apriete la rosca (eso cambia con
// la tolerancia real de cada impresora), sino de un tope de giro. Cada filete
// macho acaba en una cara recta cerca de la boca, y el surco de la tapa está
// cegado a partir de ahí: las dos caras chocan justo cuando la forma y el
// patrón de la tapa coinciden con los del tarro. La tapa llega al hombro unos
// grados antes y a los flancos les queda un poco de holgura, para que una
// impresora que engorde las paredes no se atasque antes del tope.
//
// Entradas de la rosca que caben sin descuadrar: con n entradas la tapa puede
// entrar en n posiciones, así que girar 1/n de vuelta tiene que dejar igual la
// sección y los dos patrones. Devuelve el mayor n ≤ `want` que lo cumple.
function jarStarts(P, want) {
  const LUT = buildSectionLUT(P), ML = LUT.length;
  const lut = (th) => {
    let x = (th / TAU) * ML;
    x = ((x % ML) + ML) % ML;
    const i = Math.floor(x), f = x - i;
    return LUT[i] * (1 - f) + LUT[(i + 1) % ML] * f;
  };
  const ctx = { rref: P.width / 2, twist: () => 0 };
  const pats = [makePattern(P.pot, ctx), makePattern(P.linkPatterns ? P.pot : P.res, ctx)].filter(Boolean);
  const S = 240;
  for (let n = want; n > 1; n--) {
    const a = TAU / n;
    let ok = true;
    for (let i = 0; i < S && ok; i++) {
      const th = (TAU * (i + 0.37)) / S;
      if (Math.abs(lut(th + a) - lut(th)) > 0.08) ok = false;
      for (const f of pats) for (let q = 0; q < 6 && ok; q++) {
        const z = (P.height * (q + 0.5)) / 6;
        if (Math.abs(f(th + a, z) - f(th, z)) > 0.03) ok = false;
      }
    }
    if (ok) return n;
  }
  return 1;
}

function buildJar(P, qname) {
  const Q = resolveQuality(qname, P);
  const N = Q.N, K = Q.K, H = P.height;
  const k = Math.tan(((P.maxOverhang - 3) * Math.PI) / 180);
  const pr = printOf(P);
  const t = P.wall, fT = P.floor, c = P.fit, ch = P.chamfer;
  const warnings = [];
  const { twist, R, dzG, Oin, Oat, OinAt } = baseGrid(P, N, k, t);

  const lidH = jarLid(P);
  const zs = H - lidH; // unión: hombro del tarro y canto de la tapa
  const gapTop = 0.6; // el cuello no llega a tocar el techo de la tapa
  const zT = H - fT - gapTop; // boca del tarro

  // Rosca trapecial (mismos dientes que la de la maceta)
  const thP = P.threadPitch, thS0 = Math.max(1, Math.round(P.threadStarts));
  const thS = jarStarts(P, thS0);
  if (thS < thS0) warnings.push({ level: 'info', text: `Con esta forma y este patrón la tapa solo cuadra en ${thS === 1 ? 'una posición' : thS + ' posiciones'}: la rosca se hace de ${thS} ${thS === 1 ? 'entrada' : 'entradas'} para que no pueda entrar descuadrada.` });
  const thFl = 0.38, thH = k * thFl * thP;
  const cDil = c * Math.sqrt(1 + k * k);
  const drop = cDil / k;
  let mnT = Infinity;
  for (let r = 0; r < R; r++) {
    if (r * dzG < zs - 1) continue;
    for (let j = 0; j < N; j++) mnT = Math.min(mnT, Oin[r * N + j]);
  }
  const rN = mnT - (thH + cDil + 0.4); // cuello por fuera (raíz de la rosca)
  const rNi = rN - t; // boca
  const rF0 = rN + cDil; // cresta de la rosca hembra
  if (rNi < 9) warnings.push({ level: 'error', text: 'La boca queda demasiado estrecha: ensancha el tarro o reduce el paso de la rosca.' });
  const thBot = zs + 0.8, thTop = zT - 0.4, thLen = Math.max(0, thTop - thBot);
  if (thLen < thP * 1.2) warnings.push({ level: 'warn', text: `La rosca solo mide ${thLen.toFixed(0)} mm: sube la tapa o baja el paso para que agarre.` });
  const tooth = (u) => {
    u -= Math.floor(u);
    const a = 0.5 - thFl;
    if (u < thFl) return u / thFl;
    if (u < thFl + a) return 1;
    if (u < 2 * thFl + a) return 1 - (u - thFl - a) / thFl;
    return 0;
  };
  const phase = (th, z) => z / thP - (thS * th) / TAU; // a derechas: se cierra girando en el sentido del reloj
  // Altura del centro de la cresta del filete que pasa por (θ, z): crece a lo
  // largo de la hélice, así que «zc > cota» corta el filete en una cara recta
  // (un plano radial), igual para todas las entradas.
  const thMid = thFl + (0.5 - thFl) / 2;
  const crestZ = (th, z) => { const u = phase(th, z); return z - thP * (u - Math.floor(u) - thMid); };
  const lead = thP * thS;
  const zStop = thTop - thP * (2 * thFl + 0.5 - thFl - thMid); // el último diente cabe entero bajo thTop
  // Las caras del tope son rampas de `stopW` mm de arco (casi rectas, pero más
  // anchas que una columna de la malla para que salgan iguales en cualquier
  // calidad). `arcZ` pasa mm de arco en el cuello a altura a lo largo de la hélice.
  const stopW = 0.6, arcZ = lead / (TAU * rN), zRamp = stopW * arcZ;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const male = (th, z) => (z < thBot || z > thTop ? 0 : Math.max(0, Math.min(thH * tooth(phase(th, z)) * clamp01((zStop - crestZ(th, z)) / zRamp), k * (z - thBot), k * (thTop - z))));
  // Hembra: con la tapa en el hombro y contra el tope, al flanco que aprieta le
  // queda `slack` de holgura en vertical (subida `drop` entera, tocaría). El
  // surco se ciega pasado el final del filete macho: ese es el tope de giro.
  // En la boca de la tapa se abre para que entre sola.
  const slack = Math.min(drop, 0.75 * c), fUp = drop - slack;
  // Las dos rampas son paralelas: con el mismo corte quedarían a `cDil` en
  // radial, que son stopW·cDil/thH de giro libre. Se deja 0,4 × holgura de arco,
  // lo que suelen engordar las dos caras al imprimirse.
  const stopOff = (0.4 * c - (stopW * cDil) / thH) * arcZ;
  const female = (th, z) => Math.max(rF0 + thH * tooth(phase(th, z - fUp)) * clamp01((zStop + stopOff - crestZ(th, z - fUp)) / zRamp), rF0 + thH - k * (z - zs));

  const ctx = { rref: P.width / 2, twist };
  const lidPat = makePattern(P.pot, ctx);
  const jarPat = makePattern(P.linkPatterns ? P.pot : P.res, ctx);
  const fade = 2.5;
  const wLid = (z) => smooth(zs + P.bandSeam, zs + P.bandSeam + fade, z) * smooth(H - P.bandRim, H - P.bandRim - fade, z);
  const wJar = (z) => smooth(P.bandBase, P.bandBase + fade, z) * smooth(zs - P.bandSeam, zs - P.bandSeam - fade, z);

  // ── Tarro ────────────────────────────────────────────────────────────────
  const L = 5; // puntos del hombro
  const Mb = Math.max(16, Math.ceil(zs / Q.dz)), Mn = Math.max(10, Math.ceil((zT - zs) / Q.dz));
  const jMo = Mb + L + Mn, jMi = Math.max(24, Math.ceil((zT - fT) / Q.dz));
  const jPc = jMo + K + jMi;
  const jRr = new Float64Array(N * jPc), jZz = new Float64Array(N * jPc);
  const zCone = zs - 0.4 * t; // el cono interior acaba un poco antes para dejar pared bajo el hombro
  const jarIn = (j, z) => (z >= zCone ? rNi : Math.min(OinAt(j, z), rNi + k * (zCone - z)));
  for (let j = 0; j < N; j++) {
    const th = (TAU * j) / N, base = j * jPc;
    const dzb = zs / (Mb - 1);
    let prev = 0;
    for (let q = 0; q < Mb; q++) {
      const z = dzb * q;
      let r = Oat(j, z) + (jarPat ? jarPat(th, z) * wJar(z) : 0);
      if (q > 0) r = Math.min(r, prev + k * dzb);
      prev = r;
      jRr[base + q] = z < ch ? r - (ch - z) : r;
      jZz[base + q] = z;
    }
    const rTop = Math.max(prev, rN + 0.8);
    jRr[base + Mb - 1] = rTop;
    for (let q = 0; q < L; q++) {
      jRr[base + Mb + q] = rTop + ((rN - rTop) * (q + 1)) / (L + 1);
      jZz[base + Mb + q] = zs;
    }
    const dzn = (zT - zs) / (Mn - 1);
    for (let q = 0; q < Mn; q++) {
      const z = zs + dzn * q;
      jRr[base + Mb + L + q] = rN + male(th, z);
      jZz[base + Mb + L + q] = z;
    }
    for (let q = 0; q < K; q++) {
      jRr[base + jMo + q] = rN + ((rNi - rN) * (q + 1)) / (K + 1);
      jZz[base + jMo + q] = zT;
    }
    const o = base + jMo + K, d = (zT - fT) / (jMi - 1);
    for (let q = 0; q < jMi; q++) { const z = zT - d * q; jRr[o + q] = jarIn(j, z); jZz[o + q] = z; }
    for (let q = jMi - 2; q >= 0; q--) jRr[o + q] = Math.max(jRr[o + q], jRr[o + q + 1] - k * d);
    for (let q = 0; q < jMi; q++) {
      const z = jZz[o + q];
      jRr[o + q] = Math.min(jRr[o + q], (z >= zs ? rN : Oat(j, z)) - 0.5 * t);
    }
  }
  const jarMesh = assemble(N, jPc, jRr, jZz, [], jMo, K);
  // el hombro es una cara plana: se pinta con perímetros que siguen su contorno
  for (let j = 0; j < N; j++) {
    const base = j * jPc, rTop = jRr[base + Mb - 1];
    for (let q = Mb; q <= Mb + L; q++) jarMesh.across[base + q] = Math.abs(rTop - jRr[base + q]);
  }

  // ── Tapa, en su postura de impresión (boca abajo) ────────────────────────
  // z' = H − z y θ' = −θ: un giro de media vuelta, no un espejo.
  const lMo = Math.max(12, Math.ceil(lidH / Q.dz)), lMi = Math.max(12, Math.ceil((lidH - fT) / Q.dz));
  const lPc = lMo + K + lMi;
  const lRr = new Float64Array(N * lPc), lZz = new Float64Array(N * lPc);
  for (let j = 0; j < N; j++) {
    const ja = (N - j) % N, th = (TAU * ja) / N, base = j * lPc;
    const dzo = lidH / (lMo - 1);
    let prev = 0;
    for (let q = 0; q < lMo; q++) {
      const zp = dzo * q, z = H - zp;
      let r = Oat(ja, z) + (lidPat ? lidPat(th, z) * wLid(z) : 0);
      if (q > 0) r = Math.min(r, prev + k * dzo);
      prev = r;
      lRr[base + q] = zp < ch ? r - (ch - zp) : r;
      lZz[base + q] = zp;
    }
    const o = base + lMo + K, d = (lidH - fT) / (lMi - 1);
    for (let q = 0; q < lMi; q++) { const zp = lidH - d * q; lRr[o + q] = female(th, H - zp); lZz[o + q] = zp; }
    for (let q = lMi - 2; q >= 0; q--) lRr[o + q] = Math.max(lRr[o + q], lRr[o + q + 1] - k * d);
    for (let q = 0; q < lMi; q++) lRr[o + q] = Math.min(lRr[o + q], Oat(ja, H - lZz[o + q]) - 0.5 * t);
    const roL = lRr[base + lMo - 1], riF = lRr[o];
    for (let q = 0; q < K; q++) {
      lRr[base + lMo + q] = roL + ((riF - roL) * (q + 1)) / (K + 1);
      lZz[base + lMo + q] = lidH;
    }
  }
  const lidMesh = assemble(N, lPc, lRr, lZz, [], lMo, K);

  // ── Probeta: el cuello solo, para probar la rosca con la tapa de verdad ──
  const nMi = Math.max(8, Math.ceil((zT - zs) / Q.dz));
  const neck = makeRing({ N, K, dz: Q.dz, k, ch }, zs, () => zT, (j, th, z) => rN + male(th, z), nMi, (j, th, z1, ri, rz) => {
    for (let q = 0; q < nMi; q++) { ri[q] = rNi; rz[q] = z1 - ((z1 - zs) * q) / (nMi - 1); }
  });

  // ── Cifras ───────────────────────────────────────────────────────────────
  const rowR = new Float64Array(N);
  let cap = 0;
  for (let z = fT + 0.5; z < zT; z += 1) {
    for (let j = 0; j < N; j++) rowR[j] = jarIn(j, z);
    cap += polyArea(rowR, N) * Math.min(1, zT - z + 0.5);
  }
  const lidStats = meshStats(lidMesh, P.maxOverhang, 0);
  const jarStats = meshStats(jarMesh, P.maxOverhang, 0);
  const neckStats = meshStats(neck, P.maxOverhang, 0);
  const fits = (s, h) => s.size[0] <= BED.x - 4 && s.size[1] <= BED.y - 4 && h <= BED.z;
  const info = {
    kind: 'jar', totalH: H, flip: H,
    pot: { ...lidStats.info, height: lidH, fits: fits(lidStats.info, lidH) },
    res: { ...jarStats.info, height: zT, fits: fits(jarStats.info, zT) },
    waterMl: 0, soilL: 0, capacityMl: cap / 1000, mouth: rNi * 2,
    level: 0, zpb: 0, za: zs, rIns: rN, rf: 0, zTopMin: lidH, zTopMax: lidH, footDia: 0, holes: 0, wick: null,
    thread: { pitch: thP, starts: thS, depth: thH, length: thLen, turns: thLen / (thP * thS), stop: true },
    print: {
      ...pr, vase: false, wall: t,
      perimeters: Math.max(1, Math.round(t / pr.line)),
      layersPot: Math.ceil(lidH / pr.layer), layersRes: Math.ceil(zT / pr.layer),
    },
    coupon: { grams: neckStats.info.grams, neck: { height: neckStats.info.size[2], grams: neckStats.info.grams } },
  };
  if (t < pr.line * 0.95) warnings.push({ level: 'warn', text: `La pared (${t.toFixed(1).replace('.', ',')} mm) es más fina que una línea de la boquilla de ${String(pr.nozzle).replace('.', ',')} (${String(pr.line).replace('.', ',')} mm): súbela o no saldrá.` });
  if (thH < pr.layer * 2.5) warnings.push({ level: 'warn', text: 'Los dientes de la rosca tienen muy pocas capas con esta boquilla: sube el paso de la rosca.' });
  if (!info.pot.fits) warnings.push({ level: 'error', text: `La tapa no cabe en la ${BED.name} (220×220×250).` });
  if (!info.res.fits) warnings.push({ level: 'error', text: `El tarro no cabe en la ${BED.name}.` });
  if (lidStats.islands || jarStats.islands) warnings.push({ level: 'error', text: 'Hay partes que empiezan en el aire: necesitarían soportes.' });
  if (lidStats.overhangArea > 40 || jarStats.overhangArea > 40) warnings.push({ level: 'error', text: 'Hay zonas con voladizo: actívalas en "Ver voladizos".' });

  return {
    pot: lidMesh, res: jarMesh, water: null,
    coupon: { neck },
    overhang: { pot: lidStats.over, res: jarStats.over },
    overhangArea: { pot: lidStats.overhangArea, res: jarStats.overhangArea },
    islands: { pot: lidStats.islands, res: jarStats.islands, coupon: neckStats.islands },
    info, warnings,
  };
}
