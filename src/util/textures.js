import * as THREE from "three";
import { mulberry32, fbm, noise2, clamp } from "../world/noise.js";

export function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

export function texFrom(canvas, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** Turn a grayscale height canvas into a tangent-space normal map. */
export function normalFromCanvas(src, strength = 2.0) {
  const size = src.width;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  const data = sctx.getImageData(0, 0, size, size).data;
  const hAt = (x, y) => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return data[(yi * size + xi) * 4] / 255;
  };
  const out = makeCanvas(size);
  const octx = out.getContext("2d");
  const img = octx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        hAt(x - 1, y - 1) + 2 * hAt(x - 1, y) + hAt(x - 1, y + 1) -
        (hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1));
      const dy =
        hAt(x - 1, y - 1) + 2 * hAt(x, y - 1) + hAt(x + 1, y - 1) -
        (hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1));
      let nx = dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Draw a height field into a canvas using a function returning 0..1. */
export function canvasFromFn(size, fn) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = clamp(fn(x / size, y / size, x, y), 0, 1);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------------------ */
/* Banana leaf                                                         */
/* ------------------------------------------------------------------ */

/**
 * Leaf texture laid out with the midrib along u = 0.5, length along v.
 * Returns albedo + normal + roughness.
 */
export function makeBananaLeafMaps(size = 512) {
  const albedo = makeCanvas(size);
  const ctx = albedo.getContext("2d");
  const rnd = mulberry32(91);

  // base gradient: emerald core -> yellow-olive margins
  const g = ctx.createLinearGradient(0, 0, size, 0);
  g.addColorStop(0.0, "#4f7d34");
  g.addColorStop(0.16, "#5d9a3c");
  g.addColorStop(0.5, "#79b94c");
  g.addColorStop(0.84, "#5f9c3c");
  g.addColorStop(1.0, "#4b7530");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // long parallel veins fanning out from the midrib
  for (let i = 0; i < 150; i++) {
    const u = rnd();
    const x0 = u * size;
    const spread = (u - 0.5) * 2;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.bezierCurveTo(
      x0 + spread * size * 0.16, size * 0.35,
      x0 + spread * size * 0.28, size * 0.68,
      x0 + spread * size * 0.42, size
    );
    ctx.strokeStyle = rnd() > 0.55 ? "rgba(212,232,168,0.20)" : "rgba(38,74,30,0.20)";
    ctx.lineWidth = 0.6 + rnd() * 1.4;
    ctx.stroke();
  }

  // midrib
  const mid = ctx.createLinearGradient(size * 0.46, 0, size * 0.54, 0);
  mid.addColorStop(0, "rgba(30,60,26,0.0)");
  mid.addColorStop(0.45, "rgba(196,224,150,0.55)");
  mid.addColorStop(0.55, "rgba(210,236,164,0.55)");
  mid.addColorStop(1, "rgba(30,60,26,0.0)");
  ctx.fillStyle = mid;
  ctx.fillRect(size * 0.46, 0, size * 0.08, size);
  ctx.fillStyle = "rgba(232,246,196,0.5)";
  ctx.fillRect(size * 0.5 - 1, 0, 2, size);

  // mottling / age spots
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 1 + rnd() * 9;
    const a = 0.02 + rnd() * 0.07;
    ctx.fillStyle = rnd() > 0.6 ? `rgba(214,222,150,${a})` : `rgba(38,64,28,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // dry brown edge damage + yellowing near tips
  for (let i = 0; i < 40; i++) {
    const edge = rnd() > 0.5 ? 0 : size;
    const y = rnd() * size;
    ctx.fillStyle = `rgba(150,112,52,${0.05 + rnd() * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(edge + (rnd() - 0.5) * size * 0.06, y, 5 + rnd() * 22, 3 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tip = ctx.createLinearGradient(0, size * 0.55, 0, size);
  tip.addColorStop(0, "rgba(196,196,84,0)");
  tip.addColorStop(1, "rgba(186,182,72,0.28)");
  ctx.fillStyle = tip;
  ctx.fillRect(0, size * 0.55, size, size * 0.45);

  // micro droplet sheen / wax
  for (let i = 0; i < 2500; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.06})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // height for normal map: midrib ridge + vein grooves
  const height = canvasFromFn(size, (u, v) => {
    const mx = Math.abs(u - 0.5);
    const ridge = Math.exp(-Math.pow(mx / 0.028, 2)) * 0.9;
    const veins = 0.5 + 0.5 * Math.sin((u * 130 + v * 22) * Math.PI * 2);
    const blotch = 0.5 + 0.5 * noise2(u * 42, v * 42);
    return 0.45 + ridge * 0.5 + veins * 0.05 + blotch * 0.08 - mx * 0.1;
  });

  const roughness = makeCanvas(64);
  const rctx = roughness.getContext("2d");
  rctx.fillStyle = "#7c7c7c";
  rctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 220; i++) {
    rctx.fillStyle = `rgba(150,150,150,${0.1 + Math.random() * 0.2})`;
    rctx.fillRect(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 5, 1);
  }
  rctx.fillStyle = "rgba(60,60,60,0.85)";
  rctx.fillRect(30, 0, 4, 64);

  return {
    map: texFrom(albedo),
    normalMap: texFrom(normalFromCanvas(height, 2.4), { srgb: false }),
    roughnessMap: texFrom(roughness, { srgb: false }),
  };
}

/* ------------------------------------------------------------------ */
/* Banana stem / pseudostem                                            */
/* ------------------------------------------------------------------ */
export function makeStemMaps(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#7c8a4e";
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(12);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size;
    ctx.strokeStyle = rnd() > 0.5 ? `rgba(96,74,46,${0.1 + rnd() * 0.3})` : `rgba(176,186,132,${0.08 + rnd() * 0.25})`;
    ctx.lineWidth = 0.5 + rnd() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (rnd() - 0.5) * 8, size * 0.4, x + (rnd() - 0.5) * 8, size * 0.7, x + (rnd() - 0.5) * 5, size);
    ctx.stroke();
  }
  // horizontal leaf-sheath rings
  for (let y = 0; y < size; y += 20 + rnd() * 22) {
    ctx.fillStyle = "rgba(58,44,30,0.20)";
    ctx.fillRect(0, y, size, 2 + rnd() * 2);
  }
  const height = canvasFromFn(size, (u, v) => 0.5 + 0.5 * noise2(u * 60, v * 8) * 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 26) * 0.1);
  return {
    map: texFrom(c),
    normalMap: texFrom(normalFromCanvas(height, 1.4), { srgb: false }),
  };
}

/* ------------------------------------------------------------------ */
/* Ground: baked macrography + tiling detail                           */
/* ------------------------------------------------------------------ */

export function makeDirtDetail(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#a9845c";
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(5);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.6 + rnd() * 3.4;
    const t = rnd();
    ctx.fillStyle = t > 0.72
      ? `rgba(196,176,150,${0.25 + rnd() * 0.5})`
      : t > 0.4
        ? `rgba(120,94,64,${0.2 + rnd() * 0.45})`
        : `rgba(82,64,44,${0.15 + rnd() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // dry straw / litter
  for (let i = 0; i < 260; i++) {
    ctx.save();
    ctx.translate(rnd() * size, rnd() * size);
    ctx.rotate(rnd() * Math.PI);
    ctx.fillStyle = `rgba(${150 + rnd() * 60},${130 + rnd() * 40},${70 + rnd() * 30},${0.2 + rnd() * 0.4})`;
    ctx.fillRect(-10 - rnd() * 18, 0, 20 + rnd() * 36, 0.8 + rnd() * 1.6);
    ctx.restore();
  }
  const height = canvasFromFn(size, (u, v) => 0.5 + 0.5 * noise2(u * 90, v * 90) * 0.6 + 0.5 * noise2(u * 260, v * 260) * 0.3);
  return {
    map: texFrom(c, { repeat: 24 }),
    normalMap: texFrom(normalFromCanvas(height, 2.2), { srgb: false, repeat: 24 }),
  };
}

export function makeGrassDetail(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#557c39";
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(77);
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const h = 4 + rnd() * 20;
    const hue = 72 + rnd() * 36;
    const lit = 22 + rnd() * 26;
    ctx.strokeStyle = `hsl(${hue} 34% ${lit}%)`;
    ctx.lineWidth = 1 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rnd() - 0.5) * 7, y - h * 0.6, x + (rnd() - 0.5) * 13, y - h);
    ctx.stroke();
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(44,32,20,${rnd() * 0.22})`;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 1 + rnd() * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  const height = canvasFromFn(size, (u, v) => 0.5 + 0.5 * fbm(u * 50, v * 50, 3) * 0.8);
  return {
    map: texFrom(c, { repeat: 22 }),
    normalMap: texFrom(normalFromCanvas(height, 1.8), { srgb: false, repeat: 22 }),
  };
}

export function makeRockDetail(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#8a8577";
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(303);
  // strata + cracks
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(${60 + rnd() * 30},${58 + rnd() * 26},${50 + rnd() * 22},${0.12 + rnd() * 0.3})`;
    ctx.lineWidth = 0.8 + rnd() * 3;
    ctx.beginPath();
    let x = rnd() * size;
    let y = rnd() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rnd() - 0.5) * 90;
      y += (rnd() - 0.3) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * 0.14;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(210,206,190,${a})` : `rgba(50,48,42,${a})`;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 0.7 + rnd() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // lichen / moss films
  for (let i = 0; i < 130; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.fillStyle = `rgba(${110 + rnd() * 40},${128 + rnd() * 40},${72 + rnd() * 30},${0.05 + rnd() * 0.16})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + rnd() * 26, 4 + rnd() * 16, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return {
    map: texFrom(c, { repeat: 16 }),
  };
}

/* ------------------------------------------------------------------ */
/* Foliage cards for shrubs & trees                                    */
/* ------------------------------------------------------------------ */

/** Alpha-cut cardboard cluster of leaves used for shrubs and tree canopies. */
export function makeFoliageCard({ size = 512, palette, leafShape = "ovate", density = 160, seed = 4 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const rnd = mulberry32(seed);
  const cx = size / 2;
  const cy = size / 2;
  for (let i = 0; i < density; i++) {
    // gaussian-ish blob positions inside a circle
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.6) * size * 0.46;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.92;
    const s = (0.35 + rnd() * 0.85) * size * 0.045;
    const rot = rnd() * Math.PI * 2;
    const shade = palette[Math.floor(rnd() * palette.length)];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = shade;
    ctx.beginPath();
    if (leafShape === "ovate") {
      ctx.ellipse(0, 0, s * 1.9, s * 0.74, 0, 0, Math.PI * 2);
    } else if (leafShape === "needle") {
      ctx.ellipse(0, 0, s * 2.6, s * 0.2, 0, 0, Math.PI * 2);
    } else {
      ctx.ellipse(0, 0, s * 1.5, s * 1.5, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    // central vein
    ctx.strokeStyle = "rgba(0,0,0,0.14)";
    ctx.lineWidth = Math.max(0.5, s * 0.09);
    ctx.beginPath();
    ctx.moveTo(-s * 1.8, 0);
    ctx.lineTo(s * 1.8, 0);
    ctx.stroke();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Palmate leaf (castor-oil like) for foreground accents. */
export function makePalmateLeafMaps(size = 512, lobes = 9) {
  const albedo = makeCanvas(size);
  const ctx = albedo.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;
  const cy = size * 0.94;
  const rnd = mulberry32(44);
  for (let i = 0; i < lobes; i++) {
    const a = -Math.PI / 2 + (i - (lobes - 1) / 2) * 0.3;
    const len = size * (0.72 + rnd() * 0.22);
    const w = size * 0.055;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, "#3f6f30");
    g.addColorStop(0.55, "#5f9c39");
    g.addColorStop(1, "#79b34a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(w, -len * 0.35, w * 0.8, -len * 0.75, 0, -len);
    ctx.bezierCurveTo(-w * 0.8, -len * 0.75, -w, -len * 0.35, 0, 0);
    ctx.fill();
    // primary veins
    ctx.strokeStyle = "rgba(226,240,190,0.34)";
    ctx.lineWidth = 1.1;
    for (let v = -3; v <= 3; v++) {
      ctx.beginPath();
      ctx.moveTo(0, -len * 0.06);
      ctx.quadraticCurveTo(v * w * 0.24, -len * 0.55, v * w * 0.5, -len * 0.94);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(240,248,214,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len);
    ctx.stroke();
    ctx.restore();
  }
  const height = canvasFromFn(size, (u, v) => {
    const dx = u - 0.5;
    const dy = 0.94 - v;
    const r = Math.hypot(dx, dy);
    return clamp(1.2 - r * 1.3, 0, 1) * 0.9 + 0.1;
  });
  return {
    map: texFrom(albedo),
    normalMap: texFrom(normalFromCanvas(height, 2.0), { srgb: false }),
    alphaTest: true,
  };
}

/** Small generic bark for tree trunks. */
export function makeBarkMaps(size = 256) {
  const c = makeCanvas(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#5d5142";
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(88);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * size;
    ctx.strokeStyle = rnd() > 0.5 ? `rgba(38,32,24,${0.15 + rnd() * 0.4})` : `rgba(130,118,96,${0.1 + rnd() * 0.3})`;
    ctx.lineWidth = 1 + rnd() * 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y < size; y += 24) ctx.lineTo(x + (rnd() - 0.5) * 9, y);
    ctx.stroke();
  }
  const height = canvasFromFn(size, (u, v) => 0.5 + 0.5 * noise2(u * 30, v * 8) * 0.7);
  return {
    map: texFrom(c, { repeat: 3 }),
    normalMap: texFrom(normalFromCanvas(height, 1.6), { srgb: false, repeat: 3 }),
  };
}
