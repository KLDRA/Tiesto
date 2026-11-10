# Tiesto — Documentación técnica

Diseñador web de macetas autorregantes en dos piezas, que se imprimen sin soportes. Todo se ejecuta en el navegador: no hay backend, compilación ni dependencias npm. Esta guía explica cómo funciona por dentro y cómo modificarlo. El uso de la herramienta se explica en [README.md](README.md).

---

## Infraestructura

No hay servidor de aplicación: `web/` se sirve como archivos estáticos. La copia pública está en GitHub Pages (https://kldra.github.io/Tiesto/); la acción `.github/workflows/pages.yml` copia `web/` a la rama `gh-pages` en cada cambio de `main`. three.js r170 va copiado en `web/vendor/three/` (sin CDN) y la fuente Archivo se carga de Google Fonts.

## Estructura

```
Tiesto/
├── README.md               uso, impresión e instalación
├── DOCS.md                 este documento
├── LICENSE                 licencia MIT
├── tools/
│   └── comprobar-mallas.mjs  prueba de mallas estancas, incluida la probeta (Node)
└── web/                    ← lo que se publica
    ├── index.html          estructura de la página y mapa de importación de "three"
    ├── css/app.css         todo el estilo
    ├── js/
    │   ├── app.js          estado, panel de controles, historial, presets, exportación
    │   ├── viewer.js       escena three.js: materiales, vistas, despiece, corte, cama
    │   ├── worker.js       Web Worker: genera la geometría y los archivos de descarga
    │   ├── geometry.js     motor de geometría (maceta + reservorio, tarro + tapa), cifras y avisos
    │   ├── shapes.js       secciones horizontales (círculo, polígono…) como tabla polar
    │   ├── patterns.js     patrones de superficie y sus miniaturas
    │   └── export.js       STL binario, 3MF y ZIP sin compresión
    └── vendor/three/       three.module.min.js, OrbitControls, RoomEnvironment
```

`geometry.js`, `shapes.js`, `patterns.js` y `export.js` no usan el DOM, así que funcionan igual en el navegador, en el worker y en Node. Por eso las pruebas pueden importarlos directamente.

## Flujo de datos

```
 panel (app.js) ──estado──▶ worker.js ──build()──▶ geometry.js ──▶ mallas + info + avisos
        ▲                                                              │
        └──────────── ficha y comprobaciones ◀── viewer.js ◀──────────┘
```

1. Cada control escribe en el objeto `state`, que es una copia de `DEFAULTS` con los cambios del usuario.
2. **Mientras se arrastra** un deslizador se pide calidad `draft`. **Al soltar** (o 260 ms después del último cambio) se pide `preview`.
3. El worker nunca recibe más de una petición a la vez. Si llegan varias mientras trabaja, solo se calcula la última (`pending`), así la interfaz no se atasca.
4. El resultado llega con los buffers transferidos (sin copia). `viewer.setResult()` crea las geometrías y `renderInfo()` pinta la ficha y los avisos.
5. **Exportar** crea un worker nuevo y aparte con calidad `export` o `high`, para no frenar la vista previa. Ese worker devuelve los archivos ya montados y luego se cierra.

### Calidades (`QUALITY` en geometry.js)

| Nombre | Columnas angulares `N` | Paso vertical `dz` | Puntos del borde `K` | Uso | Tiempo aprox.* |
|---|---|---|---|---|---|
| `draft` | 112 | 1,3 mm | 5 | arrastrando | ~50 ms |
| `preview` | 176 | 0,8 mm | 7 | vista normal | ~60 ms |
| `export` | 288 | 0,45 mm | 9 | descarga «Normal» | ~140 ms |
| `high` | 400 | 0,3 mm | 11 | descarga «Alto» | ~450 ms, 1,2 M triángulos |
| `max` | 512 | 0,25 mm | 13 | descarga «Máximo» | ~1 s, 1,7 M triángulos |
| `ultra` | 288–1024 | altura de capa | 13 | botón «Máxima calidad» | 1,3–3,8 s, hasta 6 M triángulos |
| `ultraLite` | 288–1024 | altura de capa (o más) | 11 | «Máxima calidad» en móvil | hasta 1,5 M triángulos |

`ultra` y `ultraLite` tienen presupuesto de triángulos (`budget`) y las resuelve `resolveQuality(nombre, P)`: `dz` es la altura de capa (una fila de malla por capa) y `N` son las columnas que caben, entre 288 y 1024. Con boquilla de 0,2 (capas de 0,1) salen 704 columnas; con 0,4 o más, 1024. Las normales por vértice se calculan en el trabajador (`vertexNormals`) para no parar la interfaz.

\* Medido con Node en un servidor modesto, diseño por defecto.

## Motor de geometría (`geometry.js`)

### Idea general: un «torno generalizado»

Cada pieza se construye por columnas: una por cada ángulo θⱼ, con `N` en total. Cada columna es un **perfil (r, z)** que recorre la pared completa:

```
  suelo interior ◀─ baja por dentro ◀─ borde (semicírculo o plano) ◀─ sube por fuera ◀─ base exterior
```

Todas las columnas tienen exactamente el mismo número de puntos (`Mo + K + Mi`). Por eso, al unir cada columna con la siguiente mediante cuadriláteros, sale una superficie cerrada. Los dos anillos extremos se cierran con polígonos triangulados con `ShapeUtils.triangulateShape` (earcut):
- la **base** (cara hacia −z), con los agujeros de drenaje como huecos;
- el **suelo interior** (cara hacia +z).

Cada agujero se une con un tubo. El resultado es una malla **estanca y bien orientada**: cada arista la comparten exactamente dos triángulos, en sentidos opuestos.

### Forma base O(θ, z)

```
O(θ, z) = perfil(z) · LUT(θ − giro(z))
```

- **`LUT`** (`shapes.js › buildSectionLUT`): la sección de la boca como tabla polar de 2048 radios, en mm.
  1. Se genera la curva cerrada de la forma elegida.
  2. Se normaliza para que su lado mayor mida `width`, y el fondo se multiplica por `ratio`.
  3. Se remuestrea a ángulos uniformes con `polarResample`, que rasteriza la curva por tramos y se queda con el radio mínimo donde se solapan.
- **`perfil(z)`**: `baseScale + (1 − baseScale)·g(z/H) + bulge·sin(πz/H)`, donde `g` depende del perfil: recto (lineal), cuenco (`1−(1−u)²`), trompeta (`u²`) o ese (smoothstep).
- **`giro(z)`**: lineal (`twist·z/H`) o en vaivén (`twist·sin(πz/H)`).

O se evalúa en una rejilla global de `N × (H/0,5 mm)`. Las piezas la interpolan en z.

### Pared interior O_in(θ, z)

Restar el grosor `t` al radio (desplazamiento radial) adelgazaría la pared en las esquinas de un polígono. Por eso, cada fila de la rejilla se desplaza **en el plano** según la normal de la curva (`shapes.js › offsetRow`) y se vuelve a muestrear en ángulos uniformes. Los bucles que aparecen en las puntas al desplazar hacia dentro se descartan quedándose con el radio mínimo.

### Encaje maceta ↔ reservorio

```
r_ins = min(O_in en la altura del reservorio) − waterGap     ← radio de la parte encajada (circular)
k     = tan(voladizo máx − 3°)                               ← pendiente de todos los conos
za    = altura donde empieza el cono de asiento
```

**Perfil circular de la maceta, `seatPot(z)`**, de abajo arriba:

| Tramo | Altura | Radio |
|---|---|---|
| Pie (cilindro) | `zpb → zft` | `rf` |
| Cono de sustrato | `zft → zwTop` | `rf + k·(z − zft)` |
| Parte encajada (vertical) | `zwTop → za` | `r_ins` |
| Cono de asiento | `za → …` | `r_ins + k·(z − za)` |

`za` se elige para que, en el ángulo donde la forma es más estrecha, el borde del reservorio quede justo a `resHeight`.

- **Exterior de la maceta:** `min(O + patrón, seatPot)`. Por debajo de la unión manda el perfil circular; por encima, la forma decorada.
- **Interior de la maceta:** `min(O_in, erosión(seatPot, t))`. La erosión por un disco de radio `t` se precalcula en una tabla cada 0,1 mm.
- **Interior del reservorio:** `max(O_in, dilatación(seatPot, holgura))`.
- **Borde del reservorio `zTop(θ)`:** la primera altura en la que el asiento dilatado alcanza `O − e`. `e` es el ancho plano del canto: `max(0,8; 0,45·t)` mm.
- **Inicio visible de la maceta `zv(θ)`:** donde `seatPot` alcanza `O`. Entre `zTop` y `zv` queda la ranura de la junta.

**Por qué no pueden chocar:** el exterior de la maceta siempre es ≤ `seatPot`, y el interior del reservorio siempre es ≥ `seatPot + holgura`. Como `seatPot` es circular, esto se cumple con la maceta girada en cualquier posición.

Con una forma no circular, el borde del reservorio no queda a una altura constante: sube en las esquinas (o en los pétalos), porque ahí el cono tarda más en llegar a la pared. Eso es lo que dibuja la línea ondulada entre los dos colores.

### Rosca (`joint: 'thread'`)

La rosca es una hélice sobre la parte encajada circular, así que encaja en el «torno generalizado» sin cambiar la malla: solo se suma al radio de cada columna.

```
fase(θ, z) = z / paso − entradas · θ / 2π        ← hélice a derechas
diente(u)  = trapecio: flanco 0,38 · paso, meseta 0,12 · paso (cresta y raíz)
h          = k · 0,38 · paso                      ← flancos a la pendiente de los conos
```

| Pieza | Radio en el tramo roscado |
|---|---|
| Maceta (macho) | `seatPot + min(h·diente(fase), k·(z − thBot), k·(thTop − z))`: rIns más los dientes, con entradas a pendiente k. Bajo el tramo, `seatPot` baja en cono hasta `rLow` |
| Reservorio (hembra) | `min(pared, r_F0 + h·diente(fase(z + drop)))`, con `r_F0 = rIns + holgura·√(1+k²)` y rampas a pendiente k en los extremos |

- **Tramo:** `thTop = za − 1`, `thBot = thTop − threadLen`. El suelo de la maceta (`zpb`) baja lo necesario para que quepa; si no cabe, la rosca se acorta y se avisa.
- **Tope:** sigue siendo el cono de asiento. La hembra va desplazada `drop = holgura·√(1+k²)/k` (lo que baja la maceta hasta tocar el cono), para que al asentar los dientes queden centrados en su holgura.
- **Radio de la rosca (`rIns`):** la rosca va pegada a la pared del reservorio **a su altura**: `rIns = mín(O_in en el tramo roscado y el asiento) − (h + holgura·√(1+k²) + 0,4)`. Por debajo, el cuerpo de la maceta (`rLow = mín(O_in) − waterGap`, como sin rosca) se une a la rosca con un cono a pendiente k, que por fuera se abre al subir y se imprime sin soportes.
- **Hembra maciza contra la pared:** por debajo y por encima de la rosca, la hembra se abre a pendiente k hasta tocar la pared. Es un anillo macizo que nace de la pared, sin ningún hueco detrás. En las esquinas de un polígono ese anillo es más ancho, pero el laminador lo rellena con relleno.
- **Por qué no puede haber hueco detrás:** para imprimirse sin soportes, la hembra tiene que nacer de la pared, así que cualquier hueco entre ella y la pared queda cerrado por abajo. El agua que entra por el reservorio nunca llega a él. Hubo dos versiones descartadas:
  1. Un collar colgado con la ranura abierta por abajo: la punta del collar empezaba en el aire.
  2. Un collar sobre una repisa con la ranura abierta por arriba: la ranura era un compartimento aislado. Con base estrecha, la repisa llegaba al suelo y dejaba fuera buena parte del agua.

  Desde entonces `meshStats` detecta partes en el aire, y la prueba de mallas detecta compartimentos cerrados.
- **Bases planas:** con rosca, el riego es siempre de mecha (`wick` efectivo `rope`): la maceta tiene suelo plano y apoya plana en la cama, igual que el reservorio.
- **Sentido:** a derechas. Visto desde arriba, se enrosca en el sentido de las agujas del reloj.
- **Comprobación:** simulando el enroscado columna a columna (la maceta sube `paso·entradas` por vuelta), la holgura radial en el tramo roscado no baja de ~0,42 mm con la holgura por defecto, y montada el único contacto es el cono.

### Riego

| `wick` | Pie | Fondo de la maceta (`zpb`) | Agujeros |
|---|---|---|---|
| `cone` | `rf = footDia/2`. Si el cono no cabe, se ensancha y se avisa | `floor + 1,5 mm` (queda 1,5 mm sobre el suelo del reservorio) | uno central + un anillo de `holeCount` |
| `rope` | `rf = r_ins` (suelo plano) | `floor + waterDepth`, con tope `za − 3` | central de `ropeDia` + un anillo de `holeCount` |

Si los agujeros no caben en el suelo, el anillo se reduce o se suprime.

### Sin soportes, siempre

Ningún diseño puede necesitar soportes, así que esta limitación no se puede desactivar (hasta el 2026-11-02 había un interruptor «Garantizar sin soportes»; los enlaces y diseños guardados que traen `enforce` lo ignoran). Cada columna se recorre de abajo arriba con esta pendiente `k`:
- **Rejilla global O:** se limita en ambos sentidos: `O_prev − k·dz ≤ O ≤ O_prev + k·dz`.
- **Exterior de cada pieza** (después de sumar el patrón): `r ≤ r_prev + k·dz`. Así ninguna cara exterior mira hacia abajo más del voladizo máximo. Por eso un relieve se convierte en un bisel bajo el resalte.
- **Interior:** `r ≥ r_prev − k·dz`. La pared interior no se cierra más deprisa de lo que se puede imprimir.
- Por último, el interior se limita a `exterior − 0,5·t` para que la pared nunca se invierta.

Para las caras, comprobar la pendiente en una columna de ángulo fijo es suficiente. **No basta para las partes que empiezan en el aire:** una punta en V colgante tiene todas sus caras dentro del voladizo y aun así necesita soporte. Todo saliente debe nacer de algo que tenga debajo. La componente vertical de la normal es `−r·∂r/∂z / √(r²(1+(∂r/∂z)²) + (∂r/∂θ)²)`, que en valor absoluto nunca supera `sin(atan ∂r/∂z)`.

**Detección (`meshStats`):**
- **Voladizo:** se marca cualquier triángulo con `nz < −sin(voladizo) − 0,02` que esté a más de 1 mm de la cama (una cara a α de la vertical tiene `nz = −sin α`). La superficie marcada se muestra con el botón «Voladizos» y en los avisos. Hasta el 2026-11-02 ponía `cos`, que solo coincide a 45°: con 60° marcaba como voladizo el cono de 57° y con 35° dejaba pasar caras de hasta 55°.
- **Partes en el aire (`islands`):** vértices sin ningún vecino más bajo, a más de 1 mm de la cama, cuya normal (ponderada por el ángulo de cada triángulo en el vértice) apunta hacia abajo (`nz < −0,3`). Así se distingue una punta colgante de un rincón del hueco, como la esquina entre el suelo y una pared. Con alguna, se emite un aviso de error y la ficha deja de decir «Sin soportes».

### Detalles de fabricación

- **Chaflán anti pie de elefante:** el radio exterior se reduce en `chamfer − (z − z_base)` durante el primer `chamfer` mm.
- **Canto redondeado:** el borde de la maceta es un semicírculo de `K` puntos. Sin redondeo, es un tramo plano.
- **Bordes decorativos (`rimDropFn`):** bajan el borde `zRim(θ) = H − caída(θ)`. Las formas son ondas (coseno), festón (arcos) y corona (picos). La fase se alinea con las esquinas del polígono en la boca, contando el giro.

### Probeta de encaje (`ring()` y `assembleRing()`)

Son dos aros que reproducen solo la zona del asiento, con las mismas funciones de perfil que las piezas completas pero sin patrón:

| Aro | Desde | Hasta | Exterior / interior |
|---|---|---|---|
| Maceta | `zSeat − 1` (con un mínimo de `zpb`) | `zv(θ) + 3` (como mucho `zRim − 3`) | `min(O, seatPot)` / `min(O_in, potIn)` |
| Reservorio | 3 mm más abajo que el de la maceta | `zTop(θ)` | `O` / `max(O_in, resIn)` |

- **`zSeat = za + (waterGap − holgura·√(1+k²)) / k`** es la altura a la que el asiento del reservorio empieza a superar su pared normal. Por debajo no hay contacto, así que no se imprime.
- **Perfil de cada columna:** es un bucle cerrado (fuera → canto superior → dentro → base), así que la malla es un toro estanco sin triangulaciones aparte. Los dos aros se trasladan para apoyar en z = 0.
- **Holgura sobre la mesa:** el aro de la maceta empieza 3 mm por encima del otro. Al asentarse baja `holgura·√(1+k²)/k` (0,6 mm con los valores por defecto), así que su base queda unos 2,4 mm por encima de la mesa.
- **Cifras:** se calculan en cada vista previa (`info.coupon`: gramos, alturas, holgura y bajada) para mostrar el peso en el botón. Las mallas solo viajan del worker al exportar (`exportKind: 'coupon'`); en la vista previa se descartan.

### Por qué queda firme

- La maceta se apoya por gravedad en un anillo cónico. Con el diseño por defecto, ese anillo mide unos 85–100 mm de diámetro y entre 7 y 13 mm de alto.
- **En horizontal:** el cono impide cualquier desplazamiento lateral mientras haya peso encima.
- **En vertical:** nada la retiene, porque tiene que poder levantarse para rellenar el agua.
- **Errores de impresión:** si una pieza sale más gruesa o más fina, la maceta solo se asienta más alta o más baja. Por eso la probeta se interpreta mirando la altura y la ranura, no el juego lateral.

### Cifras (`info`)

| Campo | Cálculo |
|---|---|
| `volume`, `grams`, `meters` | Volumen con signo de la malla (suma de tetraedros). Gramos = cm³ × 1,24 (PLA). Metros para filamento de 1,75 mm |
| `size`, `height` | Caja de la pieza. La altura de la maceta es `H − zpb` |
| `fits` | Cabe en `BED` (220 × 220 × 250), con 4 mm de margen en x/y |
| `waterMl` | Suma por capas de 1 mm, hasta el nivel de llenado: área interior del reservorio − área de la maceta. El nivel es la parte alta del cono con mecha de sustrato, o `zpb − 1` con cuerda |
| `soilL` | Área interior de la maceta, desde su suelo hasta 12 mm por debajo del borde |

### Avisos (`warnings`)

Cada aviso es `{ level: 'error' | 'warn' | 'info', text }`. Se emiten en estos casos:
- unión demasiado baja (se sube sola);
- pie del cono ensanchado;
- profundidad de agua limitada;
- hueco lateral ampliado o rosca acortada (con rosca);
- unión casi en el borde;
- borde decorativo que baja hasta la unión;
- alguna pieza no cabe en la cama;
- menos de 80 ml de agua;
- zonas con voladizo;
- partes que empiezan en el aire.

## Parámetros (`DEFAULTS`)

| Clave | Por defecto | Rango en el panel | Significado |
|---|---|---|---|
| `shape` | `poly` | circle · poly · squircle · flower · pebble | Sección |
| `sides` | 6 | 3–12 | Lados del polígono |
| `rounding` | 0,35 | 2–100 % | Radio de las esquinas (fracción de la apotema) |
| `squareness` | 4 | 2,5–12 | Exponente de la superelipse |
| `lobes` | 7 | 3–14 | Pétalos de la flor |
| `lobeDepth` | 0,14 | 3–30 % | Profundidad de la flor o irregularidad del guijarro |
| `seed` | 3 | 1–60 | Número de guijarro |
| `twist`, `twistMode` | 30, `linear` | −180–180°, linear · wave | Giro de la sección con la altura |
| `ratio` | 1 | 50–100 % | Fondo / ancho |
| `height` | 150 | 70–245 mm | Altura total montada |
| `width` | 130 | 60–210 mm | Lado mayor de la boca |
| `baseScale` | 0,78 | 45–110 % | Base respecto a la boca |
| `profile` | `linear` | linear · bowl · flare · s | Curva del perfil |
| `bulge` | 0 | −15–20 % | Barriga |
| `resHeight` | 62 | 30 – (altura − 30) mm | Altura mínima de la unión |
| `waterGap` | 4 | 2–16 mm | Hueco lateral entre la parte encajada y el reservorio |
| `joint` | `seat` | seat · thread | Unión encajada (solo cono) o con rosca |
| `threadPitch`, `threadStarts`, `threadLen` | 5, 2, 12 | 3–8 mm, 1–4, 6–30 mm | Paso, entradas y largo de la rosca |
| `wick` | `cone` | cone · rope | Sistema de riego (con rosca se usa siempre `rope`) |
| `footDia` | 44 | 20–90 mm | Diámetro del pie del cono |
| `ropeDia`, `waterDepth` | 8, 25 | 5–14, 10–70 mm | Solo con mecha de cuerda |
| `holeDia`, `holeCount` | 4, 6 | 2–8 mm, 0–12 | Agujeros de drenaje |
| `pot`, `res` | ver abajo | | Patrón de cada pieza |
| `linkPatterns` | false | | El reservorio usa el patrón de la maceta |
| `bandBase`, `bandRim`, `bandSeam` | 3, 3, 0 | 0–30 mm | Bandas sin patrón (con 2,5 mm de transición) |
| `rimStyle` | `flat` | flat · wave · scallop · crown | Borde superior |
| `rimAmp`, `rimCount`, `rimPhase` | 6, 6, 0 | 1–24 mm, 2–32, ±180° | Forma del borde |
| `rimRound` | true | | Canto redondeado |
| `wall`, `floor` | 2, 2 | 1,2–4 mm | Grosores |
| `fit` | 0,4 | 0,15–1 mm | Holgura del encaje |
| `maxOverhang` | 45 | 35–60° | Voladizo máximo (los conos usan este valor − 3°) |
| `chamfer` | 0,5 | 0–1,2 mm | Chaflán de la primera capa |
| `colors.pot`, `colors.res` | `#E3B23C`, `#24503F` | | Color de cada bobina |

**Patrón** (`pot` / `res`):

| Clave | Rango | Significado |
|---|---|---|
| `type` | id del patrón | |
| `amp` | 0–4 mm | Relieve, siempre hacia fuera (la pared nunca queda más fina que `wall`) |
| `count` | 3–72 | Repeticiones alrededor (entero, para que el motivo cierre sin costura) |
| `period` | 3–40 mm | Alto del motivo |
| `shape` | 0–1 | «Carácter» del patrón |
| `lean` | ±60° | Inclinación en espiral |
| `seed` | 1–99 | Variación (Celdas, Facetado) |
| `invert` | | Invierte el relieve |
| `followTwist` | | El patrón gira con la forma |

## Patrones (`patterns.js`)

Cada patrón es una función `f(u, v, shape, count, seed) → [0, 1]`:
- `u` es la posición alrededor, en celdas: periódica con periodo `count`.
- `v = z / period` es la altura en motivos.

`makePattern()` añade la inclinación, el seguimiento del giro, la inversión y la amplitud, y devuelve `d(θ, z)` en mm. Las bandas lisas se aplican después, en `geometry.js` (`wPot`, `wRes`).

| id | Nombre | Carácter | Nota |
|---|---|---|---|
| `none` | Liso | — | |
| `flutes` | Estrías | Redondez | Coseno elevado a una potencia |
| `ribs` | Nervios | Grosor | Banda con bordes suaves |
| `steps` | Escalones | Curva | Crece hacia arriba y cae de golpe: la cara que cae mira hacia arriba, así que siempre es imprimible |
| `waves` | Ondas | Oleaje | Anillos ondulados |
| `zigzag` | Zigzag | Quiebro | Estrías que zigzaguean |
| `diamonds` | Rombos | Meseta | Pirámides en tresbolillo |
| `lattice` | Celosía | Grosor | Crestas en las dos diagonales |
| `hex` | Panal | Pared | Red hexagonal (F2 − F1). Al quitar voladizos se ve algo ondulado |
| `cells` | Celdas | Pared | Voronoi con desplazamiento aleatorio que cierra sin costura en `u` |
| `scales` | Escamas | Solape | La escama más baja queda encima |
| `bricks` | Ladrillos | Junta | Hiladas alternas |
| `weave` | Cestería | Hebras | Damero de hebras de 2 o 3 |
| `facets` | Facetado | Contraste | Triángulos con alturas al azar (interpolación lineal) |
| `dots` | Puntos | Tamaño | Cúpulas en red hexagonal |

**Añadir un patrón:**
1. Añade `{ id, name, knob, f }` a `PATTERNS`.
2. La función debe ser periódica en `u` con periodo `count`. Si usa celdas al azar, usa `mod(i, count)` en el hash.
3. El selector, la miniatura y el panel lo recogen solos.
4. Si no usa el alto del motivo o la inclinación, añade su id a las condiciones `when` de `patternItems()` en `app.js`.

**Añadir una forma:**
1. Añade un `case` en `sectionCurve()` (`shapes.js`) que devuelva la curva en sentido antihorario, con su lado mayor ≈ 1.
2. Añade `{ id, name }` a `SHAPES`.
3. Añade sus controles a la sección «Forma» de `app.js`, con `when: (s) => s.shape === 'id'`.

## Visor (`viewer.js`)

- **Escena:** el eje Z es la vertical, igual que en la impresora (`camera.up = (0,0,1)`). Cámara de 28° con perspectiva poco exagerada, `NeutralToneMapping` para que los colores se parezcan a los del filamento, iluminación de estudio (`RoomEnvironment`), una luz principal con sombra suave y otra de contraluz cálida, y un suelo que solo recoge la sombra.
- **Material de impresión («igual que impreso»):** `MeshStandardMaterial` ampliado con `onBeforeCompile`. Uniformes `uLayer` (altura de capa), `uLine` (ancho de línea) y `uZ0` (z de la base de la pieza: las capas de la maceta empiezan en `zpb`); salen de `info.print` en `setResult`. En cada píxel:
  - **Paredes:** la normal recorre el arco del cordón de esa capa (`fract((z − uZ0)/uLayer)`). Según la pendiente de la pared, una parte del tramo es el escalón entre capas: la cara de arriba del cordón inferior, o la de abajo del superior en los voladizos. Los surcos se oscurecen y cada capa lleva una variación mínima de brillo.
  - **Caras planas** (normal de la cara casi vertical): líneas de ancho `uLine`. En los cantos siguen el contorno gracias al atributo `across` de la malla (distancia en mm a la cara exterior); en suelos y bases (`across = −1`) son rectas a 45°.
  - **Pendiente:** se toma de la normal suavizada y solo en las aristas vivas, donde se aparta de la normal real de la cara (`dFdx/dFdy` de la posición), manda la cara.
  - **Filtrado:** con `fwidth` se distinguen tres regímenes. Capa de más de ~10 px: perfil real. Entre ~4 y 10 px: solo su onda fundamental (un perfil con aristas más fino que el píxel hace moiré en forma de vetas). Menos de 2 px: nada, y la rugosidad sube 0,22.
  - **Tapa de corte:** las caras traseras se pintan con el color de la pieza aclarado un 28 %. En la vista de corte simula plástico recién cortado.
- **Vistas:**
  - **Despiece:** la maceta sube con un muelle subamortiguado (k = 170, amortiguación 0,78).
  - **Corte:** plano de recorte `y = 0`, con el agua visible.
  - **En la cama:** dos placas de 220 × 220 con su volumen de impresión.
  - Con «reducir movimiento» del sistema activado, todo es instantáneo.
- **Máxima calidad (`setHQ`):**
  - Activa el supermuestreo, `pixelRatio = min(3, 2·devicePixelRatio)`.
  - Sube el mapa de sombras de 2048 a 4096 px (lo libera para que se vuelva a crear) y suaviza la sombra (radio 7).
  - En `app.js`, mientras está activo, cada petición `preview` se convierte en `ultra`. Si el equipo es táctil o declara menos de 4 GB (`navigator.deviceMemory`), se usa `ultraLite`.
- **Guardar imagen (`snapshot(maxSide)`):** dibuja la vista por teselas de 2048 px con `camera.setViewOffset` y las copia sobre un lienzo 2D con el degradado del fondo. El lado largo mide 8192 px (4096 en móvil; si falla, la mitad), sin depender de la ventana ni de la memoria de vídeo. Unos 50 s con renderizado por software en este servidor.
- **Zoom:** `minDistance = 12` y `zoomToCursor`, para acercarse hasta contar capas.
- **Render bajo demanda:** solo se pinta un fotograma cuando cambia algo (controles, animaciones o geometría nueva).
- **Agua:** malla solo de visualización, construida igual que las piezas pero con el perfil cerrado entre el reservorio y la maceta, hasta el nivel de llenado.

## Exportación (`export.js`, `worker.js`)

- **STL binario:** normales calculadas por triángulo. La maceta se desplaza `−zpb` para que apoye en z = 0.
- **3MF:** un `basematerials` con un color por pieza y dos objetos colocados lado a lado en el centro de la cama (110, 110). Se escribe por trozos para no generar cadenas gigantes.
- **ZIP:** formato «store» (sin compresión) con CRC32 propio. El de descarga incluye `LEEME.txt`, generado en `readmeText()`.
- **Probeta:** `tiesto-probeta.zip` contiene `tiesto-probeta-maceta.stl`, `tiesto-probeta-reservorio.stl` y un `LEEME.txt` (`couponText()`) con el procedimiento de prueba y cómo corregir la holgura.

## Estado, enlaces y almacenamiento

- **Enlace:** `#d=<base64url(JSON)>`. Solo guarda las claves que difieren de `DEFAULTS`, así que los enlaces son cortos y siguen funcionando si cambian los valores por defecto. Se actualiza solo 400 ms después de cada cambio.
- **`localStorage`:**
  - `tiesto.saved`: diseños guardados, `[{ name, p }]`;
  - `tiesto.open`: secciones del panel abiertas.

  Todo el acceso va en `try/catch`: si el navegador lo bloquea, la herramienta sigue funcionando.
- **Historial:** hasta 80 pasos. Se guarda un paso al soltar un deslizador o al pulsar un botón, no en cada fotograma del arrastre.

## Diseño de la interfaz

- **Tipografía:** Archivo variable. Los títulos usan anchura 112–125 y peso 680–800; el texto, anchura 100. Las cifras son tabulares (`tnum`).
- **Paleta:** neutros fríos (`--ink #141613`, `--panel #FBFBF9`) sobre un fondo de estudio en degradado radial con grano. El color lo ponen las dos bobinas (`--c-pot`, `--c-res`). Las usan:
  - el logotipo;
  - los marcadores de sección;
  - los deslizadores de los patrones;
  - las miniaturas;
  - el botón de descarga;
  - las bobinas de la ficha, dibujadas con anillos de filamento enrollado.
- **Movimiento:**
  - curva `cubic-bezier(0.23, 1, 0.32, 1)`;
  - pulsación `scale(0.96–0.98)` en 140 ms;
  - entrada de sección en 220 ms;
  - encuadre de cámara en 650 ms;
  - despiece con muelle.
- **Responsive:** la barra de vistas pasa a dos filas cuando no cabe junto al logo. Por debajo de 860 px:
  - la vista 3D queda fija arriba (56 % de la altura) y el panel se desplaza debajo;
  - el botón de descarga queda pegado abajo;
  - «Máxima calidad», «Guardar imagen» y «Voladizos» quedan solo con su icono, en columna a la derecha.

## Boquilla, capas y modo vaso

`printOf(P)` devuelve lo que depende de la impresora: `nozzle` (uno de `NOZZLES`), `layer = nozzle · layerRatio` (25–75 %), `line = 1,1 · nozzle` y `vaseLine = 1,5 · nozzle`. `info.print` añade los perímetros que caben en la pared y las capas de cada pieza. En modo normal la boquilla no cambia la geometría, solo el dibujo y los avisos (pared más fina que una línea).

**Modo vaso (`vase: true`)**, en `build()`:
- `t = vaseLine`, sin rosca, borde plano y sin holgura (`c = 0,05`, solo para que no se toquen en pantalla).
- Cara exterior como siempre, pero limitada a pendiente k en los dos sentidos, porque la interior la copia.
- Reservorio: `r = min(O + patrón, O_min(resH) + k·(resH − z))`. Se recoge hasta un aro circular plano a la altura de la unión; el cono de la maceta (`seatPot`) llega justo a su radio interior.
- `vaseInner()` saca la cara interior fila a fila con `offsetRow(fila exterior, t)`: la pared mide un ancho de línea también donde hay relieve.
- Sin probeta (`coupon = null`). El agua se calcula con la pared real.
- El STL lleva la pared modelada: sirve con el modo vaso del laminador o con un perímetro.

## Tarros con tapa de rosca (`kind: 'jar'`, `buildJar()`)

`build()` deriva a `buildJar()` cuando `P.kind === 'jar'`. Comparte con la maceta `baseGrid()` (la forma O y su desplazada O_in, ya limitadas a pendiente k), los patrones, `assemble()` y `makeRing()`. El resultado tiene la misma forma que el de la maceta para que visor, exportación e interfaz no se dupliquen: **`pot` es la tapa y `res` el tarro**; `water` es `null`.

- Unión a `zs = H − lidHeight`. Boca del tarro a `zT = H − floor − 0,6` (no toca el techo de la tapa: el tope es el hombro).
- Cuello: `rN = min(O_in sobre la tapa) − (thH + cDil + 0,4)`, así la tapa conserva al menos pared + 0,4 mm por fuera de la raíz de la hembra. Boca `rNi = rN − wall`.
- **Tarro:** el perfil exterior de cada columna es cuerpo (0 → zs, con patrón) + hombro plano (5 puntos a z = zs) + cuello con el diente macho (zs → zT). Por dentro, `min(O_in, rNi + k·(zs − 0,4·wall − z))`: bajo el hombro el interior se cierra en cono a pendiente k, macizo, sin techo plano. `across` se rellena a mano en el hombro para que se pinte con perímetros.
- **Tapa:** se genera directamente en su postura de impresión, boca abajo: `z' = H − z`, `θ' = −θ` (media vuelta sobre X, no un espejo, para no cambiar el sentido de la rosca). Exterior O + patrón; interior, la rosca hembra maciza hasta la pared. `info.flip = H` le dice al visor que la gire (`potFlip`) en las vistas montada, despiece y corte; en la cama y en los STL va tal cual. El uniforme `uFlip` invierte «arriba» en el sombreado de capas.
- **Rosca:** mismos dientes trapeciales que la de la maceta (flancos a pendiente k, hélice a derechas). La hembra es la macho dilatada `cDil` y **subida `drop = cDil/k`**: con la tapa en el hombro, los flancos de apriete ya se tocan justo en el ángulo en que las formas coinciden. Comprobado numéricamente: hueco radial mínimo 0 y escalón 0 en la costura.
- Probeta: `coupon.neck`, el cuello solo como aro; el zip añade la tapa real.
- `info`: `kind`, `totalH`, `flip`, `capacityMl`, `mouth`, `thread`; `zpb = 0` y `zTopMax = lidHeight` para que el despiece y el encuadre funcionen sin casos especiales.
- En la interfaz (`app.js`): `isJar`, `isVase` (el vaso se ignora en tarros), `partNames()` para los rótulos, secciones con `when` y título dinámico, y mínimos de deslizador dinámicos.

## Pruebas

```bash
node tools/comprobar-mallas.mjs
```

Genera dieciocho diseños muy distintos (cuatro con rosca, uno de base estrecha, cuatro en modo vaso con boquillas de 0,2 a 1,0 y cinco tarros) en calidad `preview` y `export`, con sus dos piezas y los aros de la probeta: 118 mallas. De cada malla indica las aristas no compartidas por exactamente dos triángulos (`nonManifoldEdges`), las aristas mal orientadas (`badOrient`) y los triángulos degenerados. También indica las partes que empiezan en el aire de cada pieza (`islas`) y las columnas cuyo perfil interior vuelve a subir, lo que deja un compartimento cerrado donde no llega el agua o la tierra. Las aristas, las islas y los compartimentos deben ser **0**. Algún triángulo degenerado suelto en `export` lo producen puntos colineales en la triangulación del suelo, y los laminadores lo ignoran. La prueba también muestra el agua, el sustrato y las cotas del encaje.

Para revisar la interfaz sin pantalla sirve Chromium de Playwright. Para que funcione WebGL hay que lanzarlo con `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

## Limitaciones conocidas

- La parte encajada y los conos son siempre circulares. Es a propósito: así encaja en cualquier rotación y con formas retorcidas.
- La reserva de agua es modesta en macetas pequeñas: 100–300 ml en los diseños de partida. Se amplía subiendo la unión o el hueco lateral.
- El patrón Panal se ve algo ondulado, porque el bisel bajo cada nervio suaviza los hexágonos.
- El peso supone pared maciza de PLA. El laminador dará un número algo distinto según perímetros y relleno.
- En calidad «Alto», el STL de la maceta puede superar los 30 MB.
- `ultra` solo se usa para ver, no para exportar: hasta 300 MB de STL sin mejorar la impresión. Para descargar, el tope es «Máximo».
- El dibujo capa a capa es un sombreado, no geometría: la silueta no muestra el escalonado (menos de media capa) ni el redondeo de esquinas de la boquilla (medio ancho de línea), y no se dibuja la costura.
- En modo vaso el cono de la maceta asienta en un aro de una sola línea: es firme, pero menos que el encaje macizo del modo normal.
- La vista en máxima calidad (hasta 6 M triángulos, render a 2× y sombras de 4096 px) está pensada para un ordenador con tarjeta gráfica. Solo se ha probado con renderizado por software (SwiftShader), donde va lenta. La detección de equipos limitados (táctil o `deviceMemory < 4`) es aproximada.

- Tarros: la alineación de una tapa no redonda depende de la tolerancia real de la impresora (0,1 mm de error en z son unos 4–5° con 8 mm por vuelta). No son herméticos. La tapa es maciza entre la rosca y la forma exterior, así que en formas con esquinas pesa más. No se ha impreso ninguno todavía.

## Historial

| Fecha | Cambio |
|---|---|
| 2026-11-02 | Primera versión: motor de geometría, 5 formas, 15 patrones, 4 vistas, STL/3MF/ZIP, publicación web |
| 2026-11-02 | Se quita la muesca de llenado del reservorio: el borde queda continuo. Se riega levantando la maceta o por arriba |
| 2026-11-02 | Probeta de encaje: dos aros con solo la zona del cono para probar el ajuste antes de imprimir. Los LEEME usan coma decimal |
| 2026-11-02 | Botón «Máxima calidad» (geometría `ultra` a 0,2 mm, supermuestreo, sombras de 4096 px) y «Guardar imagen» (PNG) |
| 2026-11-02 | Unión con rosca entre maceta y reservorio, con las dos bases planas. La probeta incluye la rosca |
| 2026-11-02 | La hembra de la rosca colgaba con la punta en el aire: ahora nace de la pared sobre una repisa a pendiente k. Nueva detección de partes en el aire. Corregido el umbral de voladizo (`sin` en lugar de `cos`) |
| 2026-11-02 | Se quita el interruptor «Garantizar sin soportes»: la limitación se aplica siempre |
| 2026-11-02 | La ranura detrás de la hembra era un compartimento aislado (en bases estrechas, enorme). La rosca va pegada a la pared a su altura y la hembra es maciza. La prueba detecta compartimentos cerrados |
| 2026-11-10 | Vista «igual que impreso»: cordones, escalones y líneas por píxel según boquilla (0,2–1,0) y altura de capa. Máxima calidad con una fila por capa (hasta 6 M triángulos), imagen a 8K por teselas, descarga «Máximo». Modo vaso y cinco diseños de partida en vaso |
| 2026-11-10 | Tarros con tapa de rosca (`kind: 'jar'`): tapa que continúa la forma, generada boca abajo; cuello circular con rosca macho; probeta del cuello; seis diseños de partida |
