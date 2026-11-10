// Genera la geometría fuera del hilo principal para que los deslizadores no se traben.
import { build, vertexNormals } from './geometry.js';
import { toSTL, to3MF, zip } from './export.js';

// dirección desde la que se sirve esta copia (para la firma de los LEEME)
const SITE = (self.location.host + self.location.pathname.replace(/js\/worker\.js$/, '')).replace(/\/$/, '') || 'Tiesto';

self.onmessage = (ev) => {
  const { id, params, quality, exportKind } = ev.data;
  try {
    const r = build(params, quality);
    if (exportKind) {
      const files = exportFiles(r, params, exportKind);
      self.postMessage({ id, files }, files.map((f) => f.data.buffer));
      return;
    }
    delete r.coupon; // los aros solo viajan al exportar
    const transfer = [];
    const take = (m) => {
      if (!m) return;
      m.normals = vertexNormals(m);
      transfer.push(m.positions.buffer, m.indices.buffer, m.normals.buffer);
      if (m.across) transfer.push(m.across.buffer);
    };
    take(r.pot); take(r.res); take(r.water);
    transfer.push(r.overhang.pot.buffer, r.overhang.res.buffer);
    self.postMessage({ id, result: r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};

function exportFiles(r, P, kind) {
  // Las dos piezas se exportan en su orientación de impresión (apoyadas en z = 0)
  const potZ = -r.info.zpb;
  const potStl = () => toSTL(r.pot, nPot, potZ);
  const resStl = () => toSTL(r.res, nRes, 0);
  const base = 'tiesto';
  const jar = r.info.kind === 'jar';
  const nPot = jar ? 'tapa' : 'maceta', nRes = jar ? 'tarro' : 'reservorio';
  switch (kind) {
    case 'pot': return [{ name: `${base}-${nPot}.stl`, data: potStl() }];
    case 'res': return [{ name: `${base}-${nRes}.stl`, data: resStl() }];
    case 'coupon': if (!r.coupon) throw new Error('En modo vaso no hay probeta');
      if (jar) return [{ name: `${base}-probeta-rosca.zip`, data: zip([
        { name: `${base}-probeta-cuello.stl`, data: toSTL(r.coupon.neck, 'probeta cuello', 0) },
        { name: `${base}-tapa.stl`, data: potStl() },
        { name: 'LEEME.txt', data: new TextEncoder().encode(jarCouponText(r, P)) },
      ]) }];
      return [{ name: `${base}-probeta.zip`, data: zip([
      { name: `${base}-probeta-maceta.stl`, data: toSTL(r.coupon.pot, 'probeta maceta', 0) },
      { name: `${base}-probeta-reservorio.stl`, data: toSTL(r.coupon.res, 'probeta reservorio', 0) },
      { name: 'LEEME.txt', data: new TextEncoder().encode(couponText(r, P)) },
    ]) }];
    case '3mf': return [{ name: `${base}.3mf`, data: to3MF([
      { name: jar ? 'Tapa' : 'Maceta', mesh: r.pot, dz: potZ, color: P.colors.pot, dx: -(r.info.pot.size[0] / 2 + 4) },
      { name: jar ? 'Tarro' : 'Reservorio', mesh: r.res, dz: 0, color: P.colors.res, dx: r.info.res.size[0] / 2 + 4 },
    ]) }];
    default: {
      const readme = new TextEncoder().encode(readmeText(r, P));
      return [{ name: `${base}.zip`, data: zip([
        { name: `${base}-${nPot}.stl`, data: potStl() },
        { name: `${base}-${nRes}.stl`, data: resStl() },
        { name: 'LEEME.txt', data: readme },
      ]) }];
    }
  }
}

function couponText(r, P) {
  const c = r.info.coupon, th = r.info.thread;
  const f = (x, d = 0) => x.toFixed(d).replace('.', ',');
  if (th) return couponThreadText(c, P, f);
  return [
    'TIESTO — probeta de encaje',
    '',
    'Dos aros con solo la zona del cono de cada pieza, con los mismos conos que la',
    'maceta completa (sin el patrón, que no influye en el ajuste). Sirven para',
    'comprobar el encaje antes de imprimir las piezas enteras.',
    '',
    `Aro de la maceta      ${f(c.pot.height, 1)} mm de alto   ≈ ${f(c.pot.grams, 1)} g`,
    `Aro del reservorio    ${f(c.res.height, 1)} mm de alto   ≈ ${f(c.res.grams, 1)} g`,
    `Holgura del encaje    ${f(P.fit, 2)} mm`,
    '',
    'Imprime los dos de pie, sin soportes, con los mismos ajustes que usarás para',
    'las piezas de verdad (material, perímetros, flujo). El color da igual.',
    '',
    'Prueba:',
    '  1. Deja el aro del reservorio sobre la mesa y mete dentro el de la maceta.',
    '  2. Debe bajar solo, centrarse y quedar sin juego hacia los lados.',
    `  3. Su base debe quedar en el aire, unos ${f(c.clearance - c.drop, 1)} mm por encima de la mesa.`,
    '  4. Mira la ranura entre los dos aros: lo ideal es una línea fina y pareja de ~1 mm.',
    '',
    'Cómo corregir (Impresión → Holgura del encaje):',
    '  - Se queda alto, con una ranura ancha, o roza antes de asentar → sube la holgura 0,1 mm.',
    '  - Baja tanto que la ranura desaparece y apoya en el canto → baja la holgura 0,1 mm.',
    '  - Ranura desigual: revisa el pie de elefante o el chaflán, no la holgura.',
    '',
    `Generado en ${SITE} · ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

function couponThreadText(c, P, f) {
  return [
    'TIESTO — probeta de encaje (rosca)',
    '',
    'Dos aros con solo la rosca y el cono de cada pieza, iguales que en la maceta',
    'completa (sin el patrón, que no influye en el ajuste). Sirven para comprobar',
    'la rosca y el encaje antes de imprimir las piezas enteras.',
    '',
    `Aro de la maceta      ${f(c.pot.height, 1)} mm de alto   ≈ ${f(c.pot.grams, 1)} g`,
    `Aro del reservorio    ${f(c.res.height, 1)} mm de alto   ≈ ${f(c.res.grams, 1)} g`,
    `Holgura del encaje    ${f(P.fit, 2)} mm`,
    '',
    'Imprime los dos de pie, sin soportes, con los mismos ajustes que usarás para',
    'las piezas de verdad (material, perímetros, flujo). El color da igual.',
    '',
    'Prueba:',
    '  1. Deja el aro del reservorio sobre la mesa y apoya encima el de la maceta.',
    '  2. Gíralo en el sentido de las agujas del reloj: debe entrar sin forzar.',
    '  3. Al llegar al cono se para. Aprieta un poco: queda firme y sin juego.',
    `  4. Su base debe quedar en el aire, unos ${f(c.clearance - c.drop, 1)} mm por encima de la mesa.`,
    '  5. Mira la ranura entre los dos aros: lo ideal es una línea fina y pareja de ~1 mm.',
    '',
    'Cómo corregir (Impresión → Holgura del encaje):',
    '  - La rosca se atasca o cuesta girarla antes de llegar al cono → sube la holgura 0,1 mm.',
    '  - La rosca baila mucho o salta un diente al apretar → baja la holgura 0,1 mm.',
    '  - Ranura desigual: revisa el pie de elefante o el chaflán, no la holgura.',
    '',
    `Generado en ${SITE} · ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

function readmeText(r, P) {
  const i = r.info;
  const f = (x, d = 0) => x.toFixed(d).replace('.', ',');
  const pr = i.print;
  if (i.kind === 'jar') return jarReadme(r, P, f);
  if (pr.vase) return vaseReadme(r, P, f);
  return [
    'TIESTO — maceta autorregante en dos piezas',
    '',
    `Maceta     ${f(i.pot.size[0])} × ${f(i.pot.size[1])} × ${f(i.pot.height)} mm   ≈ ${f(i.pot.grams)} g   color ${P.colors.pot}`,
    `Reservorio ${f(i.res.size[0])} × ${f(i.res.size[1])} × ${f(i.res.height)} mm   ≈ ${f(i.res.grams)} g   color ${P.colors.res}`,
    `Agua ≈ ${f(i.waterMl)} ml · Sustrato ≈ ${f(i.soilL, 2)} L`,
    '',
    'Impresión (Ender 3 V3 SE u otra):',
    '  - Las dos piezas se imprimen de pie, tal como vienen en el STL. Sin soportes.',
    `  - Diseñado para boquilla de ${f(pr.nozzle, 1)} mm, capas de ${f(pr.layer, 2)} mm y líneas de ${f(pr.line, 2)} mm.`,
    `  - Pared ${f(P.wall, 1)} mm: usa al menos ${pr.perimeters} ${pr.perimeters === 1 ? 'perímetro' : 'perímetros'} para que quede maciza.`,
    `  - Son ${pr.layersPot} capas la maceta y ${pr.layersRes} el reservorio.`,
    i.wick === 'cone'
      ? '  - La maceta apoya sobre el pie del cono: añade un borde (brim) de 5 mm si la pieza es alta.'
      : '  - La maceta apoya sobre su base plana: no suele necesitar borde (brim).',
    '  - PETG aguanta mejor el agua y el sol; PLA también funciona en interior.',
    '',
    'Montaje:',
    i.wick === 'cone'
      ? '  - Llena el cono de la maceta con sustrato bien apretado: hace de mecha.'
      : `  - Pasa una cuerda de algodón por el agujero central (Ø${P.ropeDia} mm) hasta el fondo del reservorio.`,
    ...(i.thread ? [
      `  - Enrosca la maceta en el reservorio en el sentido de las agujas del reloj (${f(i.thread.turns, 1)} vueltas)`,
      '    hasta que asiente en el cono. Así montada se puede levantar entera.',
      '  - Para regar, desenrosca la maceta y rellena el reservorio (o riega por arriba: el sobrante baja al reservorio).',
    ] : [
      '  - Encaja la maceta en el reservorio: el cono la centra sola.',
      '  - Para regar, levanta la maceta y rellena el reservorio (o riega por arriba: el sobrante baja al reservorio).',
    ]),
    '',
    `Generado en ${SITE} · ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

function vaseReadme(r, P, f) {
  const i = r.info, pr = i.print;
  const bottom = Math.max(2, Math.round(P.floor / pr.layer));
  return [
    'TIESTO — maceta autorregante en dos piezas · MODO VASO',
    '',
    `Maceta     ${f(i.pot.size[0])} × ${f(i.pot.size[1])} × ${f(i.pot.height)} mm   ≈ ${f(i.pot.grams)} g   color ${P.colors.pot}`,
    `Reservorio ${f(i.res.size[0])} × ${f(i.res.size[1])} × ${f(i.res.height)} mm   ≈ ${f(i.res.grams)} g   color ${P.colors.res}`,
    `Agua ≈ ${f(i.waterMl)} ml · Sustrato ≈ ${f(i.soilL, 2)} L`,
    '',
    'Laminador (cada pieza por separado, de pie, sin soportes):',
    '  - Activa el modo vaso («Vaso en espiral» / «Spiral vase» / «Espiralizar contorno exterior»).',
    `  - Boquilla ${f(pr.nozzle, 1)} mm · altura de capa ${f(pr.layer, 2)} mm · ancho de línea ${f(pr.vaseLine, 2)} mm.`,
    `  - Capas inferiores macizas: ${bottom} (≈ ${f(P.floor, 1)} mm de suelo). Capas superiores: 0. Relleno: 0 %.`,
    '  - La pared del modelo mide justo un ancho de línea: si prefieres no usar el modo vaso,',
    '    lamina con 1 perímetro y «detectar paredes finas».',
    '  - Imprime despacio y un poco más caliente para que las capas suelden bien: el reservorio',
    '    tiene que ser estanco. Llénalo de agua sobre el fregadero antes de usarlo.',
    '  - PETG aguanta mejor el agua y el sol; PLA también funciona en interior.',
    '',
    'Montaje:',
    i.wick === 'cone'
      ? '  - Llena el cono de la maceta con sustrato bien apretado: hace de mecha.'
      : `  - Pasa una cuerda de algodón por el agujero central (Ø${P.ropeDia} mm) hasta el fondo del reservorio.`,
    '  - Apoya la maceta en el reservorio: su cono se centra solo en el aro de arriba.',
    '    No hay holgura que ajustar: asienta por contacto.',
    '  - Para regar, levanta la maceta y rellena el reservorio (o riega por arriba: el sobrante baja al reservorio).',
    '',
    `Generado en ${SITE} · ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

function jarReadme(r, P, f) {
  const i = r.info, pr = i.print, th = i.thread;
  return [
    'TIESTO — tarro con tapa de rosca',
    '',
    `Tapa   ${f(i.pot.size[0])} × ${f(i.pot.size[1])} × ${f(i.pot.height)} mm   ≈ ${f(i.pot.grams)} g   color ${P.colors.pot}`,
    `Tarro  ${f(i.res.size[0])} × ${f(i.res.size[1])} × ${f(i.res.height)} mm   ≈ ${f(i.res.grams)} g   color ${P.colors.res}`,
    `Capacidad ≈ ${f(i.capacityMl)} ml · Boca Ø${f(i.mouth)} mm`,
    '',
    'Impresión (Ender 3 V3 SE u otra):',
    '  - Sin soportes. El tarro se imprime de pie y la tapa boca abajo, apoyada en su cara',
    '    plana: los dos STL ya vienen en esa postura.',
    `  - Diseñado para boquilla de ${f(pr.nozzle, 1)} mm, capas de ${f(pr.layer, 2)} mm y líneas de ${f(pr.line, 2)} mm.`,
    `  - Pared ${f(P.wall, 1)} mm: usa al menos ${pr.perimeters} ${pr.perimeters === 1 ? 'perímetro' : 'perímetros'} para que quede maciza.`,
    `  - Son ${pr.layersPot} capas la tapa y ${pr.layersRes} el tarro.`,
    '  - Coloca la costura detrás o «alineada»: una costura aleatoria deja granos en la rosca.',
    '  - No es hermético ni apto para líquidos tal cual: las capas pueden rezumar. Para alimentos',
    '    secos usa PETG o PLA sin aditivos y lávalo a mano.',
    '',
    'Uso:',
    `  - La tapa se cierra girando en el sentido de las agujas del reloj (${f(th.turns, 1)} vueltas) y hace`,
    '    tope en el hombro del tarro.',
    '  - Si la forma no es redonda, la tapa queda alineada con el tarro justo al apretar.',
    '    Si se pasa de largo, baja la holgura 0,05 mm; si no llega o va dura, súbela.',
    `  - Rosca de ${th.starts} ${th.starts === 1 ? 'entrada' : 'entradas'}, paso ${f(th.pitch, 1)} mm, holgura ${f(P.fit, 2)} mm.`,
    '',
    `Generado en ${SITE} · ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

function jarCouponText(r, P) {
  const i = r.info, c = i.coupon;
  const f = (x, d = 0) => x.toFixed(d).replace('.', ',');
  return [
    'TIESTO — probeta de rosca',
    '',
    'El cuello del tarro, solo, y la tapa de verdad. Sirven para comprobar la rosca',
    'antes de imprimir el tarro entero: la tapa que imprimas ya es la definitiva.',
    '',
    `Aro del cuello   ${f(c.neck.height, 1)} mm de alto   ≈ ${f(c.neck.grams, 1)} g`,
    `Tapa             ${f(i.pot.height, 1)} mm de alto   ≈ ${f(i.pot.grams, 1)} g`,
    `Holgura          ${f(P.fit, 2)} mm`,
    '',
    'Imprime los dos tal como vienen, sin soportes, con los mismos ajustes que usarás',
    'para el tarro (material, perímetros, flujo).',
    '',
    'Prueba:',
    '  1. Deja el aro sobre la mesa y enrosca la tapa en el sentido de las agujas del reloj.',
    '  2. Debe entrar sin forzar y bajar hasta tocar la mesa (en el tarro, toca el hombro).',
    '  3. Al llegar abajo no debe bailar ni saltar un diente si aprietas un poco más.',
    '',
    'Cómo corregir (Impresión → Holgura de la rosca):',
    '  - Se atasca o cuesta girar → sube la holgura 0,1 mm.',
    '  - Baila mucho o salta al apretar → baja la holgura 0,1 mm.',
    '  - Solo roza al empezar: revisa el pie de elefante (chaflán) y la costura.',
    '',
    `Generado en ${SITE} · ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}
