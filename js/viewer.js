// Visor 3D: estudio fotográfico, plástico mate con líneas de capa al acercar,
// despiece con muelle, corte con tapas de sección y vista de la cama.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/addons/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/addons/RoomEnvironment.js';
import { BED } from './geometry.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Plástico impreso: cada capa es un cordón de sección redondeada. El sombreado
// reconstruye en cada píxel lo que deja la impresora, a partir de la altura de
// capa y el ancho de línea reales:
//  - en las paredes, la normal recorre el arco del cordón; donde la pared se
//    inclina aparece el escalón (la parte de arriba del cordón de debajo, o la
//    de abajo del de encima en los voladizos);
//  - en las caras planas que miran arriba o abajo se ven las líneas: perímetros
//    que siguen el contorno en los cantos y relleno recto a 45° en los suelos;
//  - los surcos entre cordones quedan algo más oscuros;
//  - cuando una capa ocupa menos de un par de píxeles, el relieve se funde en
//    una superficie algo más mate en vez de hacer moiré.
function printMaterial(hex) {
  const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  m.userData.cap = new THREE.Color(hex);
  m.userData.u = { uCap: { value: m.userData.cap }, uLayer: { value: 0.2 }, uLine: { value: 0.44 }, uZ0: { value: 0 }, uFlip: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float across;\nvarying vec3 vLp;\nvarying float vAcross;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = transformed;\nvAcross = across;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLp;
        varying float vAcross;
        uniform vec3 uCap;
        uniform float uLayer, uLine, uZ0, uFlip;
        float tiestoHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // uFlip = −1 cuando la pieza se enseña dada la vuelta respecto a como se imprime (la tapa)
          vec3 upV = normalize((viewMatrix * vec4(0.0, 0.0, uFlip, 0.0)).xyz);
          vec3 dpx = dFdx(vViewPosition), dpy = dFdy(vViewPosition);
          vec3 fN = normalize(cross(dpx, dpy));            // normal real de la cara, hacia la cámara
          float sF = clamp(dot(fN, upV), -1.0, 1.0);       // cuánto mira hacia arriba la cara
          // La pendiente sale de la normal suavizada (continua de un triángulo a otro);
          // solo en las aristas vivas, donde se aparta de la cara real, manda la cara.
          float sN = clamp(dot(normal, upV), -1.0, 1.0);
          float sS = mix(sN, sF, smoothstep(0.2, 0.45, abs(sN - sF)));
          vec3 nh = normal - upV * sN;       // dirección horizontal (suavizada)
          float nhl = length(nh);
          nh = nhl > 1e-4 ? nh / nhl : normalize(fN - upV * sS + vec3(1e-5));
          float cS = sqrt(max(0.0, 1.0 - sS * sS));
          float flatW = smoothstep(0.93, 0.985, abs(sF));  // 1 = cara plana (canto, suelo, base)

          // ── paredes: cordones apilados ──
          float t = (vLp.z - uZ0) / uLayer;
          float f = fract(t);
          float lay = floor(t);
          // Tres regímenes según los píxeles que ocupa una capa: de cerca, el perfil
          // real del cordón; a media distancia solo su onda fundamental (un perfil con
          // aristas más fino que el píxel haría moiré); de lejos, nada.
          float fwL = fwidth(t);
          float visL = 1.0 - smoothstep(0.26, 0.5, fwL);
          float sharpL = 1.0 - smoothstep(0.07, 0.2, fwL);
          float run = abs(sS) / max(cS, 0.02);             // avance horizontal por capa, en capas
          float ft = run / (run + 1.5708);                 // parte del tramo que es escalón
          float g, step_;
          if (sS >= 0.0) { step_ = smoothstep(1.0 - ft - 0.02, 1.0 - ft + 0.02, f) * step(0.02, ft); g = clamp(f / max(1.0 - ft, 1e-3), 0.0, 1.0); }
          else { step_ = (1.0 - smoothstep(ft - 0.02, ft + 0.02, f)) * step(0.02, ft); g = clamp((f - ft) / max(1.0 - ft, 1e-3), 0.0, 1.0); }
          step_ *= sharpL;
          float wave = sin(6.2831853 * f), waveC = cos(6.2831853 * f);
          g = mix(-0.6 * wave, (2.0 * g - 1.0) * 0.93, sharpL); // los cordones se funden: el surco no llega al fondo
          vec3 bead = nh * sqrt(1.0 - g * g) + upV * g;
          vec3 wallN = normalize(mix(bead, upV * sign(sS), step_));
          vec3 wallBase = normalize(nh * cS + upV * sS);
          float groove = mix(0.95 - 0.07 * waveC, 1.0 - 0.34 * pow(abs(g) / 0.93, 6.0) * (1.0 - step_), sharpL);
          float jit = 1.0 + (tiestoHash(lay) - 0.5) * 0.035; // ninguna capa sale idéntica a la anterior
          vec3 nWall = normalize(mix(wallBase, wallN, visL));
          float shadeWall = mix(1.0, groove * jit, visL);

          // ── caras planas: líneas de perímetro o de relleno ──
          float c; vec3 dirV;
          if (vAcross < -0.5) {
            c = (vLp.x + vLp.y) * 0.70711 / uLine;
            dirV = normalize((viewMatrix * vec4(0.70711, 0.70711 * uFlip, 0.0, 0.0)).xyz);
          } else {
            c = vAcross / uLine;
            float cx = dFdx(c), cy = dFdy(c);
            vec3 r1 = cross(dpy, fN), r2 = cross(fN, dpx);
            vec3 gr = r1 * cx + r2 * cy;
            float grL = length(gr);
            dirV = grL > 1e-9 ? gr / grL : nh;
            dirV *= sign(dot(dpx, r1)) == 0.0 ? 1.0 : -sign(dot(dpx, r1));
          }
          float fwF = fwidth(c);
          float visF = 1.0 - smoothstep(0.26, 0.5, fwF);
          float sharpF = 1.0 - smoothstep(0.07, 0.2, fwF);
          float gc = 2.0 * fract(c) - 1.0;
          // cordón aplastado: plano en medio, redondo en los bordes
          float tilt = mix(-0.28 * sin(6.2831853 * fract(c)), gc * gc * gc * 0.75, sharpF);
          vec3 upF = upV * sign(sS);
          vec3 nFlat = normalize(upF + dirV * tilt * visF);
          float shadeFlat = mix(1.0, mix(0.97 - 0.05 * cos(6.2831853 * fract(c)), 1.0 - 0.3 * pow(abs(gc), 8.0), sharpF), visF);

          normal = normalize(mix(nWall, nFlat, flatW));
          diffuseColor.rgb *= mix(shadeWall, shadeFlat, flatW);
          // el relieve que ya no se resuelve se convierte en un acabado más mate
          roughnessFactor = min(1.0, roughnessFactor + 0.22 * (1.0 - mix(visL, visF, flatW)));
        }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (!gl_FrontFacing) gl_FragColor = vec4(uCap, 1.0);`);
  };
  return m;
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false }));
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.localClippingEnabled = true;

    const scene = (this.scene = new THREE.Scene());
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;

    const cam = (this.camera = new THREE.PerspectiveCamera(28, 1, 2, 6000));
    cam.up.set(0, 0, 1);
    cam.position.set(-260, -520, 300);

    this.controls = new OrbitControls(cam, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12; // lo bastante cerca para contar capas
    this.controls.zoomToCursor = true;
    this.controls.maxDistance = 2400;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.addEventListener('change', () => this.request());
    this.controls.addEventListener('start', () => this.onInteract && this.onInteract());

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb7bbb2, 0.55));
    const key = (this.key = new THREE.DirectionalLight(0xffffff, 1.9));
    key.position.set(-180, -260, 420);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.6;
    key.shadow.radius = 5;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xfff4e6, 0.55);
    rim.position.set(260, 300, 160);
    scene.add(rim);

    const ground = (this.ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), new THREE.ShadowMaterial({ opacity: 0.17 })));
    ground.receiveShadow = true;
    scene.add(ground);

    this.root = new THREE.Group();
    scene.add(this.root);
    this.potGroup = new THREE.Group();
    this.resGroup = new THREE.Group();
    this.root.add(this.potGroup, this.resGroup);

    this.matPot = printMaterial('#E3B23C');
    this.matRes = printMaterial('#24503F');
    this.matWater = new THREE.MeshPhysicalMaterial({ color: 0x3f8fd6, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    this.matOver = new THREE.MeshBasicMaterial({ color: 0xe0322a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

    this.potMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.matPot);
    this.resMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.matRes);
    for (const m of [this.potMesh, this.resMesh]) { m.castShadow = true; m.receiveShadow = true; }
    this.potOver = new THREE.Mesh(new THREE.BufferGeometry(), this.matOver);
    this.resOver = new THREE.Mesh(new THREE.BufferGeometry(), this.matOver);
    this.water = new THREE.Mesh(new THREE.BufferGeometry(), this.matWater);
    this.water.renderOrder = 2;
    // la tapa de un tarro se genera boca abajo (como se imprime): este grupo le da la vuelta
    this.potFlip = new THREE.Group();
    this.potFlip.add(this.potMesh, this.potOver);
    this.potGroup.add(this.potFlip);
    this.resGroup.add(this.resMesh, this.resOver, this.water);

    this.bed = this.makeBeds();
    this.bed.visible = false;
    scene.add(this.bed);

    this.clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.view = 'assembled';
    this.showOver = false;
    this.explode = { x: 0, v: 0, target: 0 };
    this.info = null;
    this.firstFrame = true;

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('dblclick', () => this.frame(true));
    this.request();
  }

  makeBeds() {
    const g = new THREE.Group();
    const mkPlate = () => {
      const pg = new THREE.Group();
      const shape = new THREE.Shape();
      const w = BED.x, h = BED.y, rr = 6;
      shape.moveTo(-w / 2 + rr, -h / 2);
      shape.lineTo(w / 2 - rr, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rr);
      shape.lineTo(w / 2, h / 2 - rr); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - rr, h / 2);
      shape.lineTo(-w / 2 + rr, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rr);
      shape.lineTo(-w / 2, -h / 2 + rr); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rr, -h / 2);
      const plate = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({ color: 0x2a2c2b, roughness: 0.45, metalness: 0.25 })
      );
      plate.position.z = -3.02;
      plate.receiveShadow = true;
      pg.add(plate);
      const pts = [];
      for (let x = -100; x <= 100; x += 20) pts.push(x, -h / 2 + 6, 0.05, x, h / 2 - 6, 0.05);
      for (let y = -100; y <= 100; y += 20) pts.push(-w / 2 + 6, y, 0.05, w / 2 - 6, y, 0.05);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      pg.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x4b4f4d, transparent: true, opacity: 0.8 })));
      // volumen de impresión
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, BED.z)),
        new THREE.LineDashedMaterial({ color: 0x8b908a, dashSize: 4, gapSize: 4, transparent: true, opacity: 0.7 })
      );
      box.position.z = BED.z / 2;
      box.computeLineDistances();
      pg.add(box);
      return pg;
    };
    this.plateA = mkPlate();
    this.plateB = mkPlate();
    g.add(this.plateA, this.plateB);
    return g;
  }

  setColors(pot, res) {
    this.matPot.color.set(pot);
    this.matRes.color.set(res);
    // tapa de corte: el mismo color, un poco más claro, como plástico recién cortado
    this.matPot.userData.cap.set(pot).lerp(new THREE.Color(0xffffff), 0.28);
    this.matRes.userData.cap.set(res).lerp(new THREE.Color(0xffffff), 0.28);
    this.request();
  }

  setResult(r) {
    const setGeo = (mesh, m) => {
      const old = mesh.geometry;
      const g = new THREE.BufferGeometry();
      if (m) {
        g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
        else g.computeVertexNormals();
        if (m.across) g.setAttribute('across', new THREE.BufferAttribute(m.across, 1));
      }
      mesh.geometry = g;
      old.dispose();
    };
    const setSoup = (mesh, arr) => {
      const old = mesh.geometry;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      mesh.geometry = g;
      old.dispose();
    };
    setGeo(this.potMesh, r.pot);
    setGeo(this.resMesh, r.res);
    setGeo(this.water, r.water);
    setSoup(this.potOver, r.overhang.pot);
    setSoup(this.resOver, r.overhang.res);
    this.info = r.info;
    // capas y líneas reales de esta impresión; las capas de la maceta empiezan en su base
    const pr = r.info.print;
    for (const [mat, z0] of [[this.matPot, r.info.zpb], [this.matRes, 0]]) {
      mat.userData.u.uLayer.value = pr.layer;
      mat.userData.u.uLine.value = pr.vase ? pr.vaseLine : pr.line;
      mat.userData.u.uZ0.value = z0;
    }
    this.layout(true);
    if (this.firstFrame) { this.frame(false); this.firstFrame = false; }
    this.request();
  }

  // Máxima calidad: supermuestreo (más píxeles que la pantalla) y sombras de 4096 px
  setHQ(on) {
    this.hq = on;
    const dpr = devicePixelRatio || 1;
    this.renderer.setPixelRatio(on ? Math.min(3, dpr * 2) : Math.min(2, dpr));
    const size = on ? 4096 : 2048;
    const sh = this.key.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    sh.radius = on ? 7 : 5;
    this.resize();
  }

  // Imagen PNG de la vista actual sobre el mismo fondo de estudio que la página.
  // Se dibuja por teselas, así que no depende del tamaño de la ventana: el lado
  // largo mide `maxSide` píxeles (por defecto 8192) con el mismo encuadre.
  async snapshot(maxSide = 8192) {
    const r = this.renderer, cam = this.camera;
    const el = this.canvas.parentElement;
    const cw = el.clientWidth, ch = el.clientHeight;
    const scale = maxSide / Math.max(cw, ch);
    const W = Math.round(cw * scale), H = Math.round(ch * scale);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const rad = Math.max(W, H);
    const grad = ctx.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.38, rad * 0.75);
    grad.addColorStop(0, '#F4F5F1');
    grad.addColorStop(0.48, '#EBECE7');
    grad.addColorStop(1, '#DCDED8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    const pr = r.getPixelRatio();
    const T = Math.min(2048, r.capabilities.maxTextureSize);
    try {
      r.setPixelRatio(1);
      for (let y = 0; y < H; y += T) {
        for (let x = 0; x < W; x += T) {
          const tw = Math.min(T, W - x), th = Math.min(T, H - y);
          r.setSize(tw, th, false);
          cam.setViewOffset(W, H, x, y, tw, th);
          r.render(this.scene, cam); // dibujar y copiar en el mismo instante
          ctx.drawImage(r.domElement, 0, 0, tw, th, x, y, tw, th);
        }
        await new Promise((res) => setTimeout(res, 0)); // deja respirar a la interfaz
      }
    } finally {
      cam.clearViewOffset();
      r.setPixelRatio(pr);
      this.resize();
    }
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return blob && { blob, width: W, height: H };
  }

  setOverhang(on) { this.showOver = on; this.layout(); this.request(); }

  setView(v) {
    const prev = this.view;
    this.view = v;
    this.explode.target = v === 'exploded' ? 1 : 0;
    if (reduceMotion) this.explode.x = this.explode.target;
    const clip = v === 'section' ? [this.clip] : null;
    for (const m of [this.matPot, this.matRes, this.matWater, this.matOver]) { m.clippingPlanes = clip; m.needsUpdate = true; }
    this.layout();
    if ((prev === 'bed') !== (v === 'bed')) this.frame(true);
    else if ((prev === 'exploded') !== (v === 'exploded')) this.frame(true, true);
    this.request();
  }

  layout() {
    const i = this.info;
    if (!i) return;
    const bed = this.view === 'bed';
    this.bed.visible = bed;
    this.ground.visible = !bed;
    this.water.visible = this.view === 'section' || this.view === 'exploded';
    this.potOver.visible = this.resOver.visible = this.showOver;
    const flip = !!i.flip && !bed;
    this.potFlip.rotation.x = flip ? Math.PI : 0;
    this.potFlip.position.z = flip ? i.flip : 0;
    this.matPot.userData.u.uFlip.value = flip ? -1 : 1;
    if (bed) {
      const gap = 40;
      const sx = BED.x + gap;
      this.plateA.position.set(-sx / 2, 0, 0);
      this.plateB.position.set(sx / 2, 0, 0);
      this.potGroup.position.set(-sx / 2, 0, -i.zpb);
      this.resGroup.position.set(sx / 2, 0, 0);
    } else {
      this.resGroup.position.set(0, 0, 0);
      this.potGroup.position.set(0, 0, this.explode.x * this.explodeLift());
    }
  }

  explodeLift() {
    const i = this.info;
    return i ? i.zTopMax - i.zpb + 26 : 120;
  }

  sceneRadius() {
    const i = this.info;
    if (!i) return 200;
    const w = Math.max(i.pot.size[0], i.pot.size[1], i.res.size[0], i.res.size[1]);
    if (this.view === 'bed') return BED.x + 60;
    return Math.hypot(w / 2, (i.totalH ?? i.pot.height + i.zpb) / 2) * 1.05;
  }

  frame(animate, keepDir = false) {
    const i = this.info;
    if (!i) return;
    const bed = this.view === 'bed';
    const lift = this.explode.target ? this.explodeLift() : 0;
    const H = (i.totalH ?? i.pot.height + i.zpb) + lift;
    const target = bed ? new THREE.Vector3(0, 0, 40) : new THREE.Vector3(0, 0, H * 0.5);
    const w = Math.max(i.pot.size[0], i.pot.size[1], i.res.size[0], i.res.size[1]);
    const rad = bed ? BED.x + 60 : Math.hypot(w / 2, H / 2) * 1.05;
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.55, this.camera.aspect);
    const dist = (rad / Math.sin(fov / 2)) * (aspect < 1 ? 1 / aspect : 1) * (bed ? 0.9 : 1.32);
    let dir = bed ? new THREE.Vector3(-0.18, -0.78, 0.6) : new THREE.Vector3(-0.42, -0.86, 0.36);
    if (keepDir) dir = this.camera.position.clone().sub(this.controls.target);
    dir.normalize();
    const pos = target.clone().addScaledVector(dir, dist);
    if (!animate || reduceMotion) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
      this.request();
      return;
    }
    const t0 = performance.now(), fromP = this.camera.position.clone(), fromT = this.controls.target.clone();
    const ease = (x) => 1 - Math.pow(1 - x, 4);
    this.camAnim = (now) => {
      const x = Math.min(1, (now - t0) / 650), e = ease(x);
      this.camera.position.lerpVectors(fromP, pos, e);
      this.controls.target.lerpVectors(fromT, target, e);
      if (x >= 1) this.camAnim = null;
    };
    this.request();
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  tick(now) {
    this.raf = 0;
    let busy = false;
    if (this.camAnim) { this.camAnim(now); busy = true; }
    // despiece con muelle (ligero rebote al llegar)
    const ex = this.explode;
    if (Math.abs(ex.target - ex.x) > 1e-4 || Math.abs(ex.v) > 1e-4) {
      const dt = Math.min(0.033, (now - (this.lastT || now)) / 1000) || 0.016;
      const k = 170, c = 2 * Math.sqrt(k) * 0.78;
      ex.v += (-k * (ex.x - ex.target) - c * ex.v) * dt;
      ex.x += ex.v * dt;
      if (Math.abs(ex.target - ex.x) < 1e-4 && Math.abs(ex.v) < 1e-3) { ex.x = ex.target; ex.v = 0; }
      this.layout();
      busy = true;
    }
    this.lastT = now;
    if (this.controls.update()) busy = true;
    // sombra: ajusta la cámara de sombra a la escena
    const rad = this.sceneRadius();
    const sc = this.key.shadow.camera;
    if (sc.right !== rad * 1.6) {
      sc.left = -rad * 1.6; sc.right = rad * 1.6; sc.top = rad * 1.6; sc.bottom = -rad * 1.6;
      sc.near = 10; sc.far = 2000;
      sc.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
    if (busy) this.request();
  }
}
