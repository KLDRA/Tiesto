// Sección horizontal de la maceta, guardada como tabla polar r(θ) en mm.
// Todas las formas se generan como curva cerrada densa, se normalizan a su
// caja (el lado mayor mide `width`) y se remuestrean en ángulos uniformes.

export const SHAPES = [
  { id: 'circle', name: 'Círculo' },
  { id: 'poly', name: 'Polígono' },
  { id: 'squircle', name: 'Cuadrado suave' },
  { id: 'flower', name: 'Flor' },
  { id: 'pebble', name: 'Guijarro' },
];

const TAU = Math.PI * 2;

function hash1(i, s) {
  let h = (i * 374761393 + s * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Curva unitaria (sin normalizar) en sentido antihorario.
export function sectionCurve(p, n = 1440) {
  const xs = new Float64Array(n), ys = new Float64Array(n);
  switch (p.shape) {
    case 'poly': {
      const N = Math.max(3, Math.round(p.sides));
      const a = Math.cos(Math.PI / N);
      const rho = Math.min(0.999, Math.max(0.001, p.rounding)) * a;
      const d = (a - rho) / Math.cos(Math.PI / N);
      // Por cada esquina: un arco de radio rho; los lados rectos los da el muestreo.
      const per = Math.floor(n / N);
      let k = 0;
      for (let i = 0; i < N; i++) {
        // esquinas colocadas para que siempre haya un lado plano mirando a -y (al frente)
        const al = -Math.PI / 2 + Math.PI / N + (TAU * i) / N;
        const cx = d * Math.cos(al), cy = d * Math.sin(al);
        const arcN = Math.max(8, Math.floor(per * Math.min(0.85, 0.2 + rho * 1.6)));
        const sideN = per - arcN;
        for (let q = 0; q < arcN; q++) {
          const b = al - Math.PI / N + (TAU / N) * (q / arcN);
          xs[k] = cx + rho * Math.cos(b); ys[k] = cy + rho * Math.sin(b); k++;
        }
        // lado recto hasta el inicio del arco siguiente
        const al2 = al + TAU / N;
        const b2 = al2 - Math.PI / N;
        const ex = cx + rho * Math.cos(al + Math.PI / N), ey = cy + rho * Math.sin(al + Math.PI / N);
        const nx = d * Math.cos(al2) + rho * Math.cos(b2), ny = d * Math.sin(al2) + rho * Math.sin(b2);
        for (let q = 0; q < sideN; q++) {
          const t = q / sideN;
          xs[k] = ex + (nx - ex) * t; ys[k] = ey + (ny - ey) * t; k++;
        }
      }
      return { xs: xs.subarray(0, k), ys: ys.subarray(0, k) };
    }
    case 'squircle': {
      const e = 2 / Math.max(2.05, p.squareness);
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n, c = Math.cos(t), s = Math.sin(t);
        xs[i] = Math.sign(c) * Math.pow(Math.abs(c), e);
        ys[i] = Math.sign(s) * Math.pow(Math.abs(s), e);
      }
      return { xs, ys };
    }
    case 'flower': {
      const N = Math.max(3, Math.round(p.lobes));
      const dep = p.lobeDepth;
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n;
        const s2 = Math.pow(Math.sin((N * t) / 2) ** 2, 0.85);
        const r = 1 - dep * s2;
        xs[i] = r * Math.cos(t); ys[i] = r * Math.sin(t);
      }
      return { xs, ys };
    }
    case 'pebble': {
      const seed = Math.round(p.seed) | 0;
      const amp = p.lobeDepth;
      const harm = [];
      for (let h = 2; h <= 5; h++) harm.push([h, (hash1(h, seed) * 2 - 1) * amp / (h * 0.7), hash1(h + 17, seed) * TAU]);
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n;
        let r = 1;
        for (const [h, a, ph] of harm) r += a * Math.cos(h * t + ph);
        xs[i] = r * Math.cos(t); ys[i] = r * Math.sin(t);
      }
      return { xs, ys };
    }
    default: {
      for (let i = 0; i < n; i++) {
        const t = (TAU * i) / n;
        xs[i] = Math.cos(t); ys[i] = Math.sin(t);
      }
      return { xs, ys };
    }
  }
}

// Rasteriza una curva cerrada sobre una rejilla angular uniforme `out`.
// Donde varios tramos cubren el mismo ángulo se queda con el radio mínimo
// (así se descartan los bucles que aparecen al desplazar esquinas hacia dentro).
export function polarResample(xs, ys, out) {
  const M = out.length, n = xs.length, step = TAU / M;
  out.fill(Infinity);
  let pa = Math.atan2(ys[0], xs[0]), ra = Math.hypot(xs[0], ys[0]);
  for (let i = 1; i <= n; i++) {
    const k = i % n;
    const rb = Math.hypot(xs[k], ys[k]);
    let d = Math.atan2(ys[k], xs[k]) - pa;
    d -= TAU * Math.round(d / TAU);
    const pb = pa + d;
    const lo = Math.min(pa, pb), hi = Math.max(pa, pb);
    const i0 = Math.ceil(lo / step), i1 = Math.floor(hi / step);
    for (let q = i0; q <= i1; q++) {
      const t = d === 0 ? 0 : (q * step - pa) / d;
      const r = ra + (rb - ra) * t;
      const idx = ((q % M) + M) % M;
      if (r < out[idx]) out[idx] = r;
    }
    pa = pb; ra = rb;
  }
  // huecos (no debería haber, pero por si acaso)
  for (let i = 0; i < M; i++) {
    if (out[i] !== Infinity) continue;
    let a = i, b = i;
    while (out[(a - 1 + M) % M] === Infinity && a - i > -M) a--;
    while (out[(b + 1) % M] === Infinity && b - i < M) b++;
    const va = out[(a - 1 + M) % M], vb = out[(b + 1) % M];
    for (let q = a; q <= b; q++) out[(q + M) % M] = va + (vb - va) * ((q - a + 1) / (b - a + 2));
  }
  return out;
}

// Tabla polar de la sección superior, en mm.
export function buildSectionLUT(p, M = 2048) {
  const { xs, ys } = sectionCurve(p);
  let mx = 0, my = 0;
  for (let i = 0; i < xs.length; i++) { mx = Math.max(mx, Math.abs(xs[i])); my = Math.max(my, Math.abs(ys[i])); }
  const s = 1 / Math.max(mx, my);
  const sx = (p.width / 2) * s, sy = (p.width * p.ratio / 2) * s;
  const X = new Float64Array(xs.length), Y = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) { X[i] = xs[i] * sx; Y[i] = ys[i] * sy; }
  return polarResample(X, Y, new Float64Array(M));
}

// Desplaza hacia dentro una fila (radios en ángulos uniformes) una distancia t
// medida en el plano, y la vuelve a muestrear en los mismos ángulos.
export function offsetRow(r, t, out, tmpX, tmpY) {
  const N = r.length;
  for (let j = 0; j < N; j++) {
    const a = (TAU * j) / N;
    tmpX[j] = r[j] * Math.cos(a); tmpY[j] = r[j] * Math.sin(a);
  }
  const qx = new Float64Array(N), qy = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const jp = (j + 1) % N, jm = (j - 1 + N) % N;
    const tx = tmpX[jp] - tmpX[jm], ty = tmpY[jp] - tmpY[jm];
    const l = Math.hypot(tx, ty) || 1;
    qx[j] = tmpX[j] - (t * ty) / l; qy[j] = tmpY[j] + (t * tx) / l;
  }
  return polarResample(qx, qy, out);
}

// Silueta SVG (para miniaturas de forma)
export function sectionPath(p, size = 40) {
  const { xs, ys } = sectionCurve({ ...p, width: 2, ratio: 1 }, 240);
  let mx = 0, my = 0;
  for (let i = 0; i < xs.length; i++) { mx = Math.max(mx, Math.abs(xs[i])); my = Math.max(my, Math.abs(ys[i])); }
  const s = (size / 2 - 2) / Math.max(mx, my);
  let d = '';
  for (let i = 0; i < xs.length; i += 2) d += (i ? 'L' : 'M') + (size / 2 + xs[i] * s).toFixed(2) + ' ' + (size / 2 - ys[i] * s).toFixed(2);
  return d + 'Z';
}
