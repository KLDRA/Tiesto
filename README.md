# Tiesto — macetas autorregantes y tarros con rosca, en dos colores

Herramienta web para diseñar macetas autorregantes de dos piezas, y tarros con su tapa de rosca, e imprimirlos en 3D sin soportes. Cada pieza se imprime con una bobina distinta y, una vez montadas, se ven los dos colores.

**En marcha en:** https://kldra.github.io/Tiesto/

Cada cambio en `web/` que llega a la rama `main` se publica solo en GitHub Pages (acción `.github/workflows/pages.yml`, que copia `web/` a la rama `gh-pages`).

- La **maceta** (color A) es la pieza de arriba, donde va la tierra. Su parte inferior entra en el reservorio.
- El **reservorio** (color B) es la cubeta de abajo, donde está el agua. Su exterior queda a la vista y sigue la forma de la maceta, así que montadas parecen una sola pieza partida en dos colores.

En **Qué diseñas** se elige entre *Maceta autorregante* y *Tarro con tapa*. El tarro usa las mismas formas, perfiles, patrones y colores: la **tapa** (color A) ocupa el sitio de la maceta y el **tarro** (color B) el del reservorio. Ver [Tarros con tapa de rosca](#tarros-con-tapa-de-rosca).

La parte de documentación técnica (cómo se genera la geometría, la estructura del código y cómo tocarlo) está en [DOCS.md](DOCS.md).

---

## Cómo funciona la maceta

```
            ┌───────── maceta (color A) ─────────┐
            │                                    │   ← tierra
            │                                    │
  unión ──▶ ╲                                  ╱    ← asiento cónico (autocentrante)
   ┌────────╲──────────────────────────────────╱────────┐
   │         │    parte circular encajada     │         │
   │         ╲                                ╱         │ ← reservorio (color B)
   │           ╲      cono de sustrato      ╱           │
   │  agua       ╲________________________╱      agua   │
   │               │  pie con agujeros   │              │
   └───────────────┴─────────────────────┴──────────────┘
```

1. **Asiento cónico.** La maceta no apoya en un escalón plano, sino en un cono (42° con el voladizo por defecto). El cono la centra sola al dejarla caer y no necesita soportes. La holgura por defecto es de 0,4 mm.
2. **Parte encajada circular.** Por fuera la forma puede ser un hexágono, una flor o estar retorcida. Por dentro, la parte de la maceta que entra en el reservorio es siempre circular, así que encaja girada en cualquier posición y sin roces.
3. **Riego por capilaridad.** Hay dos sistemas:
   - **Cono de sustrato** (por defecto): la maceta se estrecha hasta un pie que casi toca el fondo del reservorio. La tierra del cono toca el agua y la sube. El pie lleva agujeros para que entre el agua y salga el sobrante. No hace falta cuerda.
   - **Mecha de cuerda:** la maceta tiene el suelo plano, con un agujero central para una cuerda de algodón y otros de drenaje alrededor.
4. **Junta visible.** Entre el borde del reservorio y la maceta queda una ranura fina, de aproximadamente 1,5 mm. Marca la separación entre colores sin que se vea ninguna abertura.
5. **Para regar:** levanta la maceta y rellena el reservorio. También puedes regar por arriba: el agua que sobra baja por los agujeros al reservorio.
6. **Unión con rosca (opcional).** En «Reservorio → Unión» se elige entre *Encajada* (la maceta solo se apoya en el cono) y *Rosca*. Con rosca, la parte circular de la maceta lleva una rosca macho y el reservorio una hembra, pegada a su pared y maciza contra ella (nada empieza en el aire y no queda ningún hueco detrás donde el agua no llegue): la maceta se enrosca en el sentido de las agujas del reloj hasta asentar en el cono, y así montada se puede levantar entera. Las dos piezas tienen la base plana: la maceta pasa a llevar suelo plano con mecha de cuerda, en lugar del cono de sustrato.

## Uso de la herramienta

### Vista 3D

| Acción | Cómo |
|---|---|
| Girar | Arrastrar con el ratón o el dedo |
| Acercar | Rueda del ratón o pellizco, hacia donde apunta el cursor. Al acercarte se ve cada capa de impresión como el cordón que es, con la altura de capa y el ancho de línea de la boquilla elegida |
| **Boquilla** | 0,2 · 0,3 · 0,4 · 0,5 · 0,6 · 0,8 · 1,0 mm. Cambia al momento las capas y las líneas que se dibujan (y, en modo vaso, el grosor de la pared) |
| Recentrar | Doble clic en la vista |
| **Montada** | Las dos piezas encajadas |
| **Despiece** | La maceta sube sobre el reservorio y se ve el agua |
| **Corte** | Sección por la mitad: se ve el cono, el agua y los grosores |
| **En la cama** | Cada pieza sobre su placa de 220 × 220 mm, con el volumen de impresión en discontinua |
| **Voladizos** | Marca en rojo las caras que necesitarían soporte |
| **Máxima calidad** | Recalcula el diseño con una fila de malla por cada capa de impresión y tantas columnas como quepan (hasta 1024 y unos 6 millones de triángulos). Lo dibuja con el doble de resolución que la pantalla y sombras más finas. Sigue activo mientras cambias el diseño: al arrastrar ves una versión rápida y, al soltar, vuelve a calcular (de 1 a 4 segundos según la boquilla). En móviles se limita a 1,5 millones de triángulos |
| **Guardar imagen** | Descarga `tiesto.png` con la vista actual (ángulo, zoom y vista) sobre el fondo de estudio, a 8K: 8192 px de lado largo (4096 en móvil), sea cual sea el tamaño de la ventana. A esa resolución se distinguen las capas con la maceta entera en el encuadre |

**Igual que impreso.** El visor no pinta una superficie lisa: en cada píxel reconstruye lo que deja la impresora.
- En las paredes, cada capa es un cordón redondeado; donde la pared se inclina aparece el escalón entre capas.
- En los cantos planos se ven las líneas de perímetro siguiendo el contorno, y en los suelos el relleno recto a 45°, con el ancho de línea de la boquilla.
- Los surcos entre capas quedan algo más oscuros y ninguna capa es idéntica a la anterior.
- De lejos, cuando una capa mide menos de un par de píxeles, el relieve se funde en un acabado algo más mate, como pasa al mirar una pieza real a distancia.

La altura de capa se elige en **Impresión** (del 25 % al 75 % de la boquilla; por defecto la mitad: 0,2 mm con boquilla de 0,4).

«Máxima calidad» solo cambia lo que ves en pantalla, no lo que descargas. Mientras no lo necesites, déjalo desactivado: gasta mucha más memoria y batería.

### Ficha de impresión y comprobaciones

- **Abajo a la izquierda:** medidas de cada pieza, gramos de filamento estimados (PLA, 1,24 g/cm³), mililitros de agua y litros de sustrato.
- **Abajo a la derecha:** si cabe en la Ender 3 V3 SE, si hay voladizos, la holgura del encaje y otros avisos (unión demasiado alta, poca agua, pie ensanchado, etc.).

En el móvil, los avisos aparecen al principio del panel.

### Panel de diseño

| Sección | Opciones |
|---|---|
| **Forma** | Círculo, polígono (lados y redondeo), cuadrado suave (cuadratura), flor (pétalos y profundidad), guijarro (forma de piedra al azar, con nº de piedra). Giro (−180° a 180°, continuo o en vaivén). Proporción fondo/ancho, para macetas ovaladas o rectangulares |
| **Tamaño y perfil** | Altura total (70–245 mm), ancho (60–210 mm), base respecto a la boca, perfil (recto, cuenco, trompeta, ese) y barriga |
| **Reservorio** | Altura de la unión (a qué altura cambia de color), hueco lateral para el agua y tipo de unión: encajada o rosca (paso, entradas y largo) |
| **Riego** | Sistema (cono de sustrato o mecha de cuerda; con rosca siempre es mecha), diámetro del pie, agujero de la cuerda, profundidad del agua, diámetro y número de agujeros de drenaje |
| **Patrón de la maceta** | 15 patrones (ver abajo), relieve, repeticiones alrededor, alto del motivo, carácter, inclinación (espiral), variación, invertir y seguir el giro |
| **Patrón del reservorio** | Lo mismo, o «Igual que la maceta» para que el motivo siga sin cortes de una pieza a otra |
| **Borde y bandas lisas** | Borde superior liso, en ondas, festón o corona (altura, repeticiones, desfase), canto redondeado. Bandas sin patrón junto al borde, en la unión y en la base |
| **Colores** | 20 colores de filamento para cada pieza, o cualquier otro con el selector |
| **Impresión** | Boquilla, altura de capa, modo normal o **vaso (espiral)**, grosor de pared y de suelos, holgura del encaje, voladizo máximo y chaflán anti pie de elefante. No hay forma de desactivar la impresión sin soportes: cualquier relieve, giro o forma que se abra más que el voladizo máximo se suaviza solo |

**Patrones:** Liso, Estrías, Nervios, Escalones, Ondas, Zigzag, Rombos, Celosía, Panal, Celdas, Escamas, Ladrillos, Cestería, Facetado y Puntos. El control «Carácter» cambia de nombre según el patrón (Redondez, Grosor, Curva, Oleaje…). Las miniaturas se calculan con la misma función que el modelo y se tiñen con el color de la pieza.

**Atajos y trucos**
- Doble clic en un deslizador lo devuelve a su valor por defecto.
- Puedes escribir el valor exacto en el número de la derecha de cada deslizador.
- `Ctrl+Z` deshace y `Ctrl+Mayús+Z` rehace (también con los botones de flecha).
- **Sorpréndeme** genera un diseño al azar, siempre imprimible.
- Las secciones del panel recuerdan si las dejaste abiertas o cerradas.

### Diseños de partida

Hexa (el diseño por defecto), Torre, Panal, Flor, Guijarro, Espiral, Cesta, Cubo y Escamas, y cinco en modo vaso: Vaso Rizo, Vaso Estrías, Vaso Oleaje, Vaso Gema y Vaso Rombos. Al pulsar uno se carga entero y se puede seguir modificando. La boquilla y la altura de capa no cambian al cargar un diseño: son de tu impresora.

### Modo vaso

En **Impresión → Modo → Vaso (espiral)** cada pieza pasa a ser una sola línea continua, sin costura ni retracciones: se imprime más rápido y gasta la cuarta parte de filamento.

- La pared mide un ancho de línea (1,5 × la boquilla: 0,6 mm con boquilla de 0,4) y la cara de dentro copia el relieve de la de fuera.
- El reservorio se recoge arriba hasta un aro circular plano y el cono de la maceta se apoya en él por contacto: no hay holgura que ajustar, ni rosca, ni probeta.
- El borde es siempre liso y plano (la espiral no puede subir y bajar).
- Sigue sin necesitar soportes: la pared no se inclina más que el voladizo máximo, ni hacia fuera ni hacia dentro.
- El `LEEME.txt` de la descarga dice qué poner en el laminador: modo vaso, ancho de línea, capas inferiores y 0 capas superiores.

### Tarros con tapa de rosca

En **Qué diseñas → Tarro con tapa** la herramienta genera un tarro y su tapa enroscada.

- La tapa sigue la forma y el patrón del tarro, así que cerrado parece un solo volumen partido en dos colores. Por dentro lleva la rosca hembra; el tarro acaba en un hombro plano y un cuello circular con la rosca macho.
- **Tapa y rosca:** altura de la tapa (la rosca ocupa casi toda), paso y número de entradas. Cada vuelta baja paso × entradas.
- La tapa se cierra en el sentido de las agujas del reloj y hace tope en el hombro. Si la forma no es redonda, queda alineada con el tarro justo al apretar; si en tu impresora se pasa de largo, baja la «Holgura de la rosca» 0,05 mm, y si no llega, súbela.
- Sin soportes: el tarro se imprime de pie y la tapa **boca abajo**, apoyada en su cara plana. Los STL ya salen así, y la vista «En la cama» lo enseña.
- La ficha muestra la capacidad en ml y el diámetro de la boca.
- No hay modo vaso, borde decorado ni riego en los tarros. La altura mínima baja a 30 mm y el ancho a 30 mm.
- Diseños de partida: Tarro Hexa, Tarro Estrías, Bote Panal, Tarro Flor, Cajita y Especiero.
- **Probeta de rosca:** `tiesto-probeta-rosca.zip` trae el cuello solo (unos 15 g) y la tapa definitiva, para probar la rosca antes de imprimir el tarro entero.
- No es hermético: las capas pueden rezumar con líquidos. Para alimentos secos, PETG o PLA sin aditivos y lavado a mano.

### Guardar y compartir

- **Copiar enlace:** la dirección siempre contiene el diseño actual (`#d=…`). Al abrir ese enlace aparece exactamente el mismo diseño, en cualquier dispositivo.
- **Guardar diseño:** lo guarda en este navegador y aparece al final de la fila de diseños de partida. Se borra con la ×.

### Descargas

| Botón | Qué descarga |
|---|---|
| **Descargar las dos piezas** | `tiesto.zip` con `tiesto-maceta.stl`, `tiesto-reservorio.stl` y `LEEME.txt` (medidas, gramos, colores e instrucciones de impresión y montaje) |
| **Maceta .stl / Reservorio .stl** | Solo esa pieza |
| **Proyecto .3mf** | Las dos piezas colocadas en la cama, cada una con su color. Sirve para Creality Print, Orca, Prusa o Bambu Studio |
| **Probeta de encaje** | `tiesto-probeta.zip` con dos aros que solo tienen la zona del cono de cada pieza (y la rosca, si la hay), más un `LEEME.txt` que explica cómo interpretar el ajuste. Unos 26 g en el diseño por defecto, frente a unos 228 g de las dos piezas |
| **Detalle** | *Normal* (unos 19 MB el STL de la maceta), *Alto* (más fino, más del doble de tamaño) o *Máximo* (512 columnas y filas de 0,25 mm; unos 85 MB entre las dos piezas) |

Los STL salen ya en posición de impresión: de pie y apoyados en z = 0 (la tapa de un tarro, boca abajo). En los tarros los archivos se llaman `tiesto-tapa.stl` y `tiesto-tarro.stl`.

## Imprimir y montar

1. Imprime cada pieza de pie, tal como sale del STL, **sin soportes**, cada una con su bobina.
2. Usa suficientes perímetros para que la pared salga maciza. Con boquilla de 0,4 y pared de 2 mm son 5 perímetros. El `LEEME.txt` indica el número exacto.
3. En maceta alta conviene poner un borde (brim) de 5 mm, porque apoya sobre un pie pequeño.
4. PETG aguanta mejor el agua y el sol; PLA también vale para interior.
5. Con cono de sustrato, llena el cono con tierra bien apretada. Con mecha, pasa una cuerda de algodón por el agujero central hasta el fondo.
6. Encaja la maceta en el reservorio. Se asienta por su peso en el cono y queda sin juego lateral, pero no va sujeta: se levanta tirando hacia arriba. Con rosca, enróscala en el sentido de las agujas del reloj hasta que asiente en el cono.

### Probar el ajuste antes (probeta de encaje)

Cada impresora deja tolerancias distintas. Antes de imprimir las dos piezas enteras puedes descargar la **Probeta de encaje** e imprimir los dos aros con los mismos ajustes (material, perímetros, flujo) que vas a usar después. El color da igual.

1. Deja el aro del reservorio sobre la mesa y mete dentro el de la maceta.
2. Debe bajar solo, centrarse y quedar sin juego lateral, con su base en el aire (unos 2,4 mm por encima de la mesa con la holgura por defecto).
3. La ranura entre los dos aros debería ser una línea fina y pareja de ~1 mm.
4. Si se queda alto, con la ranura ancha, o roza antes de asentar: **sube** la «Holgura del encaje» 0,1 mm. Si baja tanto que la ranura desaparece: **bájala** 0,1 mm. Si la ranura sale desigual, el problema suele ser el pie de elefante o el chaflán, no la holgura.

Los aros llevan exactamente los mismos conos que las piezas completas, pero sin patrón, porque el patrón no influye en el ajuste.

Con rosca, los aros incluyen también el tramo roscado (unos 81 g en el diseño por defecto). La maceta debe entrar girándola sin forzar y pararse al llegar al cono. Si la rosca se atasca antes, **sube** la holgura 0,1 mm; si baila o salta un diente al apretar, **bájala**.

## Publicarlo en otro sitio

`web/` es una web estática: no hay compilación, backend ni dependencias npm. Sirve con cualquier servidor de archivos o alojamiento de páginas estáticas (GitHub Pages, Cloudflare Pages, Netlify…). Todas las rutas son relativas, así que funciona igual en la raíz que en una subcarpeta.

Para probarlo en local:

```bash
python3 -m http.server 8000 --directory web
```

Hace falta un servidor (no vale abrir `index.html` con doble clic) porque usa módulos y un Web Worker.

## Licencia

[MIT](LICENSE).
