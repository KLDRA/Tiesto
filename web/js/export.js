// Exportadores: STL binario, 3MF (dos objetos con color) y ZIP sin compresión.

export function toSTL(mesh, name, dz = 0) {
  const p = mesh.positions, ix = mesh.indices;
  const n = ix.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = `TIESTO ${name}`.slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, p[v], true); dv.setFloat32(o + 4, p[v + 1], true); dv.setFloat32(o + 8, p[v + 2] + dz, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

export function to3MF(parts) {
  const esc = (s) => s.replace(/[<&"]/g, (ch) => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const chunks = [];
  chunks.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="es-ES" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
  chunks.push('<metadata name="Application">Tiesto</metadata>\n<resources>\n<basematerials id="1">\n');
  for (const pt of parts) chunks.push(`<base name="${esc(pt.name)}" displaycolor="${pt.color.toUpperCase()}FF"/>\n`);
  chunks.push('</basematerials>\n');
  parts.forEach((pt, n) => {
    const p = pt.mesh.positions, ix = pt.mesh.indices;
    chunks.push(`<object id="${n + 2}" name="${esc(pt.name)}" type="model" pid="1" pindex="${n}">\n<mesh>\n<vertices>\n`);
    let s = '';
    for (let i = 0; i < p.length; i += 3) {
      s += `<vertex x="${p[i].toFixed(3)}" y="${p[i + 1].toFixed(3)}" z="${(p[i + 2] + pt.dz).toFixed(3)}"/>\n`;
      if (s.length > 1 << 20) { chunks.push(s); s = ''; }
    }
    chunks.push(s, '</vertices>\n<triangles>\n');
    s = '';
    for (let i = 0; i < ix.length; i += 3) {
      s += `<triangle v1="${ix[i]}" v2="${ix[i + 1]}" v3="${ix[i + 2]}"/>\n`;
      if (s.length > 1 << 20) { chunks.push(s); s = ''; }
    }
    chunks.push(s, '</triangles>\n</mesh>\n</object>\n');
  });
  chunks.push('</resources>\n<build>\n');
  parts.forEach((pt, n) => chunks.push(`<item objectid="${n + 2}" transform="1 0 0 0 1 0 0 0 1 ${(110 + pt.dx).toFixed(2)} 110 0"/>\n`));
  chunks.push('</build>\n</model>\n');
  const enc = new TextEncoder();
  const model = concat(chunks.map((c) => enc.encode(c)));
  const types = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zip([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: model },
  ]);
}

function concat(arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(d) {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ZIP "store" (sin compresión): suficiente y sin dependencias.
export function zip(files) {
  const enc = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    local.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = concat(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cd.length, true); end.setUint32(16, offset, true);
  return concat([...local, cd, new Uint8Array(end.buffer)]);
}
