import * as THREE from "three";
import { mulberry32, fbm, clamp } from "./noise.js";
import { makeBananaLeafMaps, makeStemMaps, makeFoliageCard, makePalmateLeafMaps, makeBarkMaps } from "../util/textures.js";

/* ------------------------------------------------------------------ */
/* 0. Shared wind shader patch                                        */
/* ------------------------------------------------------------------ */
export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.7 },
};

export function applyWind(material, { strength = 1.0, flutter = 0.35 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.uniforms.uStrength = { value: strength };
    shader.uniforms.uFlutter = { value: flutter };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        #ifdef USE_INSTANCING
          attribute mat4 instanceMatrix;
        #endif
        attribute float aFlex;
        varying vec3 vWindDir;
        uniform float uTime, uWind, uStrength, uFlutter;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 iAnchor = instanceMatrix[3].xyz;
            float iScale = length(instanceMatrix[1].xyz);
          #else
            vec3 iAnchor = vec3(0.0);
            float iScale = 1.0;
          #endif
          vec3 anchor = iAnchor;
          float ph = anchor.x * 0.42 + anchor.z * 0.31;
          float gust = 0.62 + 0.38 * sin(uTime * 0.23 + anchor.x * 0.02 + anchor.z * 0.017);
          float sway = sin(uTime * 1.55 + ph) * 0.62 + sin(uTime * 2.9 + ph * 1.7) * 0.28;
          float flut = sin(uTime * 5.4 + ph * 4.0 + position.y * 3.0 + position.x * 2.0) * uFlutter;
          float amp = uWind * gust * uStrength * aFlex * iScale;
          transformed.x += (sway + flut) * amp * 0.32;
          transformed.z += (cos(uTime * 1.18 + ph * 1.3) + flut * 0.7) * amp * 0.22;
          transformed.y += sin(uTime * 2.1 + ph) * amp * 0.05;
          vWindDir = normalize(mat3(modelMatrix) * normal);
        }`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWindDir;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // leaf translucency: warm light bleeding through the silhouette
        float backlit = pow(clamp(dot(normalize(vWindDir), normalize(vec3(-0.55, 0.62, 0.55))), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += diffuseColor.rgb * (0.10 + backlit) * 0.18;`
      );
  };
  material.customProgramCacheKey = () => `wind-${strength}-${flutter}`;
  return material;
}

/* ------------------------------------------------------------------ */
/* 1. Banana leaf blade                                               */
/* ------------------------------------------------------------------ */
function bananaBladeGeometry({ length = 1.7, width = 0.46, segL = 10, segW = 4, arch = 0.55, droop = 0.9, curl = 0.35, flexBase = 0.35 } = {}) {
  const positions = [];
  const uvs = [];
  const flexes = [];
  const indices = [];

  for (let i = 0; i <= segL; i++) {
    const t = i / segL;
    // width profile: narrow at base, widest at ~35%, pointed tip
    const wp = Math.sin(Math.pow(t, 0.62) * Math.PI) * 0.85 + 0.14 * (1 - t);
    const halfW = width * wp;
    for (let j = 0; j <= segW; j++) {
      const s = j / segW - 0.5;
      const x = s * 2 * halfW;
      const z = t * length;
      // arch upward near the base then droop toward the tip
      const y = arch * length * Math.sin(t * 2.0) - droop * length * t * t;
      // cross-section curl (leaf edges lift)
      const yc = y + curl * Math.abs(s) * Math.abs(s) * width * 3.0 * (0.25 + t);
      positions.push(x, yc, z);
      uvs.push(j / segW, 0.94 - t * 0.9);
      // flexibility grows down the blade
      flexes.push(flexBase + (1 - flexBase) * Math.pow(t, 1.5));
    }
  }
  for (let i = 0; i < segL; i++) {
    for (let j = 0; j < segW; j++) {
      const a = i * (segW + 1) + j;
      const b = a + 1;
      const c = a + (segW + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute("aFlex", new THREE.Float32BufferAttribute(flexes, 1));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function petioleGeometry(len, r0, r1, flex) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 4, true);
  g.translate(0, len / 2, 0);
  const count = g.attributes.position.count;
  const flexAttr = new Float32Array(count).fill(flex);
  g.setAttribute("aFlex", new THREE.BufferAttribute(flexAttr, 1));
  return g;
}

/* ------------------------------------------------------------------ */
/* 2. Banana plant variants                                           */
/* ------------------------------------------------------------------ */
let bananaMats = null;
export function getBananaMaterials() {
  if (bananaMats) return bananaMats;
  const leaf = makeBananaLeafMaps(512);
  const stem = makeStemMaps(256);

  const leafMat = new THREE.MeshStandardMaterial({
    map: leaf.map,
    normalMap: leaf.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: leaf.roughnessMap,
    roughness: 0.78,
    metalness: 0.0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  applyWind(leafMat, { strength: 1.15, flutter: 0.5 });

  const stemMat = new THREE.MeshStandardMaterial({
    map: stem.map,
    normalMap: stem.normalMap,
    roughness: 0.92,
    metalness: 0.0,
    vertexColors: true,
  });
  applyWind(stemMat, { strength: 0.22, flutter: 0.05 });

  bananaMats = { leafMat, stemMat };
  return bananaMats;
}

/** Build a full banana plant (pseudostem + crown of leaves) as merged geometry. */
export function buildBananaPlant({ seed = 1, height = 2.6, leafCount = 10, spread = 1.0, young = false } = {}) {
  const rnd = mulberry32(seed);
  const trunkParts = [];
  const leafParts = [];

  const stemH = height * (young ? 0.55 : 0.74);
  const r0 = height * 0.045 + 0.045;
  const r1 = r0 * 0.62;

  // pseudostem: tapered, slightly leaning
  const stem = new THREE.CylinderGeometry(r1, r0, stemH, 8, 6, false);
  stem.translate(0, stemH / 2, 0);
  {
    const p = stem.attributes.position;
    const lean = (rnd() - 0.5) * 0.24;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = Math.pow(Math.max(0, y / stemH), 1.5);
      p.setX(i, p.getX(i) + lean * k * stemH);
      p.setZ(i, p.getZ(i) + lean * 0.5 * k * stemH);
    }
    const flex = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) flex[i] = clamp(p.getY(i) / stemH, 0, 1) * 0.5;
    stem.setAttribute("aFlex", new THREE.BufferAttribute(flex, 1));
    stem.computeVertexNormals();
  }
  trunkParts.push({ geo: stem, color: new THREE.Color(0x93a463) });

  // leaf crown: each leaf is a petiole + blade pointing outward and drooping by age
  const crownY = stemH * 0.99;
  const UP = new THREE.Vector3(0, 1, 0);
  const FWD = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i < leafCount; i++) {
    const phase = i / leafCount;
    const azimuth = phase * Math.PI * 2 * 1.618 + rnd() * 0.45;
    const age = i / leafCount; // 0 = newest (upright), 1 = oldest (drooping)

    const isYoung = age < 0.25;
    const petLen = height * (isYoung ? 0.18 : 0.34) * (0.85 + rnd() * 0.35);
    const bladeLen = height * (isYoung ? 0.5 : 0.86) * (0.85 + rnd() * 0.4) * spread;
    const bladeWid = bladeLen * (isYoung ? 0.17 : 0.3);

    // pitch of the leaf axis above the horizon: newest leaves stand up, old ones droop
    const pitch = isYoung
      ? 0.9 + rnd() * 0.35
      : 0.55 - age * 0.85 + rnd() * 0.2;
    const dir = new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(azimuth) * Math.cos(pitch)
    ).normalize();

    // petiole from the crown toward `dir`, slightly steeper than the blade
    const petDir = new THREE.Vector3(dir.x, dir.y + 0.22, dir.z).normalize();
    const crown = new THREE.Vector3(
      Math.sin(azimuth) * r0 * 0.5,
      crownY - age * stemH * 0.13,
      Math.cos(azimuth) * r0 * 0.5
    );
    const qPet = new THREE.Quaternion().setFromUnitVectors(UP, petDir);
    const petiole = petioleGeometry(petLen, r0 * 0.3, r0 * 0.19, 0.4);
    petiole.applyMatrix4(new THREE.Matrix4().compose(crown, qPet, new THREE.Vector3(1, 1, 1)));
    leafParts.push({ geo: petiole, color: new THREE.Color(0x93a95a) });

    // blade starts where the petiole ends
    const tip = crown.clone().add(petDir.clone().multiplyScalar(petLen));
    const blade = bananaBladeGeometry({
      length: bladeLen,
      width: bladeWid,
      segL: 12,
      segW: 4,
      arch: isYoung ? 0.55 : 0.4 - age * 0.16,
      droop: isYoung ? 0.22 : 0.85 + age * 0.5,
      curl: 0.32,
      flexBase: 0.5,
    });
    const qBlade = new THREE.Quaternion().setFromUnitVectors(FWD, dir);
    const roll = new THREE.Quaternion().setFromAxisAngle(FWD, (rnd() - 0.5) * 0.5);
    qBlade.multiply(roll);
    blade.applyMatrix4(new THREE.Matrix4().compose(tip, qBlade, new THREE.Vector3(1, 1, 1)));

    const tint = 0.92 + rnd() * 0.14;
    const dry = age > 0.7 ? (age - 0.7) * 2.2 : 0;
    leafParts.push({
      geo: blade,
      color: new THREE.Color().setRGB(
        tint * (0.95 + dry * 0.42),
        tint * (1.0 - dry * 0.03),
        tint * (0.88 - dry * 0.42)
      ),
    });
  }

  // merge each group manually (keeps two materials: stem + leaf)
  const merge = (parts) => mergeSimple(parts);
  return {
    trunk: merge(trunkParts),
    leaves: merge(leafParts),
    height: stemH,
  };
}

/** Minimal geometry merge that keeps colour as vertex colours. */
function mergeSimple(parts) {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    vCount += p.geo.attributes.position.count;
    iCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);
  const flex = new Float32Array(vCount);
  const idx = new Uint32Array(iCount);

  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geo;
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), vo * 2);
    if (g.attributes.aFlex) flex.set(g.attributes.aFlex.array.subarray(0, n), vo);
    for (let i = 0; i < n; i++) {
      col[(vo + i) * 3] = p.color.r;
      col[(vo + i) * 3 + 1] = p.color.g;
      col[(vo + i) * 3 + 2] = p.color.b;
    }
    const gi = g.index ? g.index.array : null;
    if (gi) {
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = i + vo;
      io += n;
    }
    vo += n;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.setAttribute("aFlex", new THREE.BufferAttribute(flex, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export { mergeSimple };

/* ------------------------------------------------------------------ */
/* 3. Field of bananas                                               */
/* ------------------------------------------------------------------ */
export function buildBananaField(scene, opts = {}) {
  const {
    count = 260,
    region = { x0: -46, x1: 46, z0: 34, z1: -46 },
    minSpacing = 2.4,
    heightRange = [2.1, 3.5],
  } = opts;

  const mats = getBananaMaterials();
  const variants = 6;
  const geoTrunk = [];
  const geoLeaf = [];
  for (let v = 0; v < variants; v++) {
    const p = buildBananaPlant({
      seed: 100 + v * 13,
      height: 1.0,
      leafCount: 9 + (v % 3),
      spread: 0.95 + (v % 4) * 0.06,
    });
    geoTrunk.push(p.trunk);
    geoLeaf.push(p.leaves);
  }

  const buckets = Array.from({ length: variants }, () => []);
  const rnd = mulberry32(555);
  const placed = [];
  let guard = 0;
  while (placed.length < count && guard < count * 40) {
    guard++;
    const x = region.x0 + rnd() * (region.x1 - region.x0);
    const z = region.z0 + rnd() * (region.z1 - region.z0);
    // keep the trail clear
    if (Math.abs(x - trailXAt(z)) < 2.6) continue;
    // organic clumping
    const cluster = fbm(x * 0.07, z * 0.07, 3);
    if (cluster < -0.22 && rnd() > 0.25) continue;
    let ok = true;
    for (const p of placed) {
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < minSpacing * minSpacing) { ok = false; break; }
    }
    if (!ok) continue;
    placed.push({ x, z });
    const height = heightRange[0] + rnd() * (heightRange[1] - heightRange[0]);
    buckets[Math.floor(rnd() * variants)].push({ x, z, height, rot: rnd() * Math.PI * 2, lean: (rnd() - 0.5) * 0.1 });
  }

  const meshes = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let v = 0; v < variants; v++) {
    const list = buckets[v];
    if (!list.length) continue;

    const im1 = new THREE.InstancedMesh(geoTrunk[v], mats.stemMat, list.length);
    const im2 = new THREE.InstancedMesh(geoLeaf[v], mats.leafMat, list.length);
    im1.castShadow = im2.castShadow = true;
    im1.receiveShadow = im2.receiveShadow = true;
    im1.frustumCulled = im2.frustumCulled = true;

    list.forEach((p, i) => {
      e.set(p.lean * 0.4, p.rot, p.lean);
      q.setFromEuler(e);
      m4.compose(
        new THREE.Vector3(p.x, heightAtLocal(p.x, p.z) - 0.12, p.z),
        q,
        new THREE.Vector3(p.height, p.height, p.height)
      );
      im1.setMatrixAt(i, m4);
      im2.setMatrixAt(i, m4);
    });
    im1.instanceMatrix.needsUpdate = true;
    im2.instanceMatrix.needsUpdate = true;
    im1.name = `banana-stem-${v}`;
    im2.name = `banana-leaves-${v}`;
    scene.add(im1, im2);
    meshes.push(im1, im2);
  }

  return { meshes, count: placed.length, mats, placed };
}

// local import cycle avoidance: terrain height lookup injected at runtime
let _heightAt = () => 0;
let _trailXAt = () => 0;
export function bindTerrainSamplers(heightAt, trailXAt) {
  _heightAt = heightAt;
  _trailXAt = trailXAt;
}
function heightAtLocal(x, z) {
  return _heightAt(x, z);
}
function trailXAt(z) {
  return _trailXAt(z);
}

/* ------------------------------------------------------------------ */
/* 4. Grass / sedges                                                  */
/* ------------------------------------------------------------------ */
function bladeCardGeometry({ h = 0.4, w = 0.03, segs = 3, bend = 0.35 } = {}) {
  const pos = [];
  const uv = [];
  const flex = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * h;
    const z = bend * h * t * t;
    const ww = w * (1 - t * 0.92);
    pos.push(-ww, y, z, ww, y, z);
    uv.push(0, t, 1, t);
    flex.push(Math.pow(t, 1.5));
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aFlex", new THREE.Float32BufferAttribute(flex, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function grassTuftGeometry({ seed = 1, blades = 13, height = 0.45, spread = 0.16, plume = false } = {}) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < blades; i++) {
    const h = height * (0.55 + rnd() * 0.75);
    const g = bladeCardGeometry({ h, w: height * (0.035 + rnd() * 0.03), segs: 3, bend: 0.2 + rnd() * 0.55 });
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.7) * spread;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, a, (rnd() - 0.5) * 0.5)),
      new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    const shade = 0.62 + rnd() * 0.5;
    const yellow = rnd() > 0.82 ? 0.35 : 0;
    parts.push({
      geo: g,
      color: new THREE.Color().setRGB(shade * (1 + yellow * 0.55), shade * (1 + yellow * 0.15), shade * (1 - yellow * 0.5)),
    });
  }
  if (plume) {
    // yellow seed head like the tall sedge in the photos
    for (let i = 0; i < 3; i++) {
      const h = height * (1.0 + rnd() * 0.25);
      const stem = bladeCardGeometry({ h, w: height * 0.016, segs: 3, bend: 0.12 });
      const a = rnd() * Math.PI * 2;
      const m = new THREE.Matrix4().makeTranslation(Math.cos(a) * spread * 0.5, 0, Math.sin(a) * spread * 0.5);
      stem.applyMatrix4(m);
      parts.push({ geo: stem, color: new THREE.Color(0x9dae62) });

      const head = new THREE.ConeGeometry(height * 0.055, height * 0.34, 6, 1, true);
      head.translate(0, height * 0.2, 0);
      const p = head.attributes.position;
      const fl = new Float32Array(p.count).fill(0.95);
      head.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
      head.applyMatrix4(new THREE.Matrix4().makeTranslation(
        Math.cos(a) * spread * 0.5 + Math.sin(0.12) * h,
        h * 0.97,
        Math.sin(a) * spread * 0.5
      ));
      parts.push({ geo: head, color: new THREE.Color().setRGB(0.78, 0.72, 0.34) });
    }
  }
  const merged = mergeSimple(parts);
  // grass cards must be double sided geometry-wise (two-sided material handles it)
  return merged;
}

export function buildGrassField(scene, opts = {}) {
  const {
    count = 4200,
    region = { x0: -58, x1: 58, z0: 30, z1: -66 },
    tuftHeight = 'short',
    seed = 3,
  } = opts;

  const rnd = mulberry32(seed);
  const variants = 4;
  const geos = [];
  for (let v = 0; v < variants; v++) {
    geos.push(
      grassTuftGeometry({
        seed: seed * 31 + v,
        blades: 10 + v * 2,
        height: tuftHeight === "tall" ? 0.95 + v * 0.12 : 0.38 + v * 0.07,
        spread: tuftHeight === "tall" ? 0.22 : 0.15,
        plume: tuftHeight === "tall" && v % 2 === 0,
      })
    );
  }

  const mat = applyWind(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    { strength: 1.4, flutter: 0.8 }
  );

  const buckets = Array.from({ length: variants }, () => []);
  let guard = 0;
  let placed = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  while (placed < count && guard < count * 12) {
    guard++;
    const x = region.x0 + rnd() * (region.x1 - region.x0);
    const z = region.z0 + rnd() * (region.z1 - region.z0);
    const density = fbm(x * 0.05 + 3, z * 0.05 - 7, 3);
    if (density < -0.3) continue;
    const nearTrail = Math.abs(x - trailXAt(z));
    if (nearTrail < 1.9) continue;
    const v = Math.floor(rnd() * variants);
    buckets[v].push({
      x, z,
      rot: rnd() * Math.PI * 2,
      s: tuftHeight === "tall" ? 0.8 + rnd() * 0.6 : 0.7 + rnd() * 0.7,
      tilt: (rnd() - 0.5) * 0.18,
    });
    placed++;
  }

  const meshes = [];
  for (let v = 0; v < variants; v++) {
    const list = buckets[v];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(geos[v], mat, list.length);
    im.castShadow = false;
    im.receiveShadow = true;
    list.forEach((p, i) => {
      q.setFromEuler(new THREE.Euler(p.tilt, p.rot, p.tilt * 0.6));
      m4.compose(
        new THREE.Vector3(p.x, heightAtLocal(p.x, p.z) - 0.05, p.z),
        q,
        new THREE.Vector3(p.s, p.s, p.s)
      );
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = `grass-${tuftHeight}-${v}`;
    scene.add(im);
    meshes.push(im);
  }
  return { meshes, count: placed };
}

/* ------------------------------------------------------------------ */
/* 5. Shrubs & trees                                                  */
/* ------------------------------------------------------------------ */
export function buildShrubs(scene, opts = {}) {
  const { count = 220, region = { x0: -80, x1: 80, z0: 30, z1: -110 } } = opts;
  const rnd = mulberry32(909);

  const cardTex = makeFoliageCard({
    size: 512,
    palette: ["#2f5c2a", "#3d7231", "#4d8838", "#5d9c40", "#79b052"],
    leafShape: "ovate",
    density: 220,
    seed: 8,
  });

  const mat = applyWind(
    new THREE.MeshStandardMaterial({
      map: cardTex,
      alphaTest: 0.42,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0,
      vertexColors: true,
      depthWrite: true,
    }),
    { strength: 0.8, flutter: 0.35 }
  );

  // shrub = 3 crossed cards
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(1, 1, 2, 2);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    // curve the card outward a touch
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      p.setZ(k, p.getZ(k) + Math.sin(y * Math.PI) * 0.08);
    }
    g.rotateY((i / 3) * Math.PI * 2);
    const fl = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) fl[k] = Math.pow(clamp(p.getY(k), 0, 1), 1.4);
    g.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
    parts.push({ geo: g, color: new THREE.Color(0xffffff) });
  }
  const geo = mergeSimple(parts);

  const im = new THREE.InstancedMesh(geo, mat, count);
  im.castShadow = true;
  im.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  let guard = 0;
  while (n < count && guard < count * 30) {
    guard++;
    const x = region.x0 + rnd() * (region.x1 - region.x0);
    const z = region.z0 + rnd() * (region.z1 - region.z0);
    if (Math.abs(x - trailXAt(z)) < 3.5) continue;
    const s = 0.55 + rnd() * 1.25;
    q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI * 2, 0));
    m4.compose(new THREE.Vector3(x, heightAtLocal(x, z) - 0.1, z), q, new THREE.Vector3(s * 1.2, s, s * 1.2));
    im.setMatrixAt(n++, m4);
  }
  im.count = n;
  im.instanceMatrix.needsUpdate = true;
  im.name = "shrubs";
  scene.add(im);
  return { mesh: im, material: mat };
}

export function buildTrees(scene, opts = {}) {
  const {
    count = 90,
    region = { x0: -150, x1: 150, z0: 10, z1: -190 },
    scaleRange = [1.7, 3.8],
  } = opts;
  const rnd = mulberry32(2024);

  const bark = makeBarkMaps(256);
  const canopyTex = makeFoliageCard({
    size: 512,
    palette: ["#20441f", "#2b5726", "#376b2c", "#457f32", "#5a923c"],
    leafShape: "ovate",
    density: 340,
    seed: 21,
  });

  const trunkMat = new THREE.MeshStandardMaterial({
    map: bark.map,
    normalMap: bark.normalMap,
    roughness: 0.95,
    vertexColors: true,
  });
  applyWind(trunkMat, { strength: 0.16, flutter: 0.02 });

  const canopyMat = applyWind(
    new THREE.MeshStandardMaterial({
      map: canopyTex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
      vertexColors: true,
    }),
    { strength: 0.5, flutter: 0.28 }
  );

  // tree prototype geometry (unit-ish, scaled per instance)
  const trunkParts = [];
  const canopyParts = [];

  const trunkH = 3.4;
  const trunk = new THREE.CylinderGeometry(0.11, 0.26, trunkH, 7, 5);
  trunk.translate(0, trunkH / 2, 0);
  {
    const p = trunk.attributes.position;
    const fl = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) fl[i] = clamp(p.getY(i) / trunkH, 0, 1) * 0.35;
    trunk.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
  }
  trunkParts.push({ geo: trunk, color: new THREE.Color(0x6a5a44) });

  const branchCount = 5;
  for (let i = 0; i < branchCount; i++) {
    const a = (i / branchCount) * Math.PI * 2 + 0.4;
    const len = 1.5 + rnd() * 0.9;
    const b = new THREE.CylinderGeometry(0.035, 0.075, len, 5, 2);
    b.translate(0, len / 2, 0);
    const fl = new Float32Array(b.attributes.position.count).fill(0.45);
    b.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
    const tilt = 0.75 + rnd() * 0.35;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)).multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt)
    );
    b.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(0, trunkH * (0.72 + rnd() * 0.2), 0),
      q,
      new THREE.Vector3(1, 1, 1)
    ));
    trunkParts.push({ geo: b, color: new THREE.Color(0x5d4f3a) });
  }

  // canopy: several curved cards arranged as a rough sphere
  const cardN = 9;
  for (let i = 0; i < cardN; i++) {
    const g = new THREE.PlaneGeometry(2.6, 2.2, 3, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      p.setZ(k, -(x * x + y * y) * 0.12);
    }
    g.computeVertexNormals();
    const fl = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) fl[k] = 0.55 + clamp(p.getY(k) / 2, 0, 1) * 0.45;
    g.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
    const a = (i / cardN) * Math.PI * 2;
    const r = 0.9 + (i % 3) * 0.45;
    const y = trunkH + 0.6 + (i % 4) * 0.55;
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.6, a + Math.PI / 2, (rnd() - 0.5) * 0.4)),
      new THREE.Vector3(1, 1, 1)
    ));
    canopyParts.push({ geo: g, color: new THREE.Color(0xffffff) });
  }

  const trunkGeo = mergeSimple(trunkParts);
  const canopyGeo = mergeSimple(canopyParts);

  const list = [];
  let guard = 0;
  while (list.length < count && guard < count * 40) {
    guard++;
    const x = region.x0 + rnd() * (region.x1 - region.x0);
    const z = region.z0 + rnd() * (region.z1 - region.z0);
    const s = fbm(x * 0.02, z * 0.02, 3);
    if (s < -0.15 && rnd() > 0.3) continue;
    // avoid the immediate foreground
    if (z > 22 && Math.abs(x) < 30) continue;
    list.push({ x, z, scale: scaleRange[0] + rnd() * (scaleRange[1] - scaleRange[0]), rot: rnd() * Math.PI * 2 });
  }

  const imT = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
  const imC = new THREE.InstancedMesh(canopyGeo, canopyMat, list.length);
  imT.castShadow = imC.castShadow = true;
  imC.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  list.forEach((t, i) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.rot, 0));
    m4.compose(new THREE.Vector3(t.x, heightAtLocal(t.x, t.z) - 0.3, t.z), q, new THREE.Vector3(t.scale * 0.9, t.scale, t.scale * 0.9));
    imT.setMatrixAt(i, m4);
    imC.setMatrixAt(i, m4);
  });
  imT.instanceMatrix.needsUpdate = true;
  imC.instanceMatrix.needsUpdate = true;
  imT.name = "tree-trunks";
  imC.name = "tree-canopies";
  scene.add(imT, imC);

  return { trunks: imT, canopies: imC, count: list.length };
}

/* ------------------------------------------------------------------ */
/* 6. Foreground accent: castor-oil palmate plant + dead straw        */
/* ------------------------------------------------------------------ */
export function buildAccentPlants(scene) {
  const palm = makePalmateLeafMaps(512, 9);
  const mat = applyWind(
    new THREE.MeshStandardMaterial({
      map: palm.map,
      normalMap: palm.normalMap,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.72,
      vertexColors: true,
    }),
    { strength: 1.0, flutter: 0.6 }
  );

  const parts = [];
  const rnd = mulberry32(71);
  const leafN = 7;
  for (let i = 0; i < leafN; i++) {
    const g = new THREE.PlaneGeometry(1.5, 1.5, 2, 2);
    const a = (i / leafN) * Math.PI * 2 + rnd() * 0.3;
    const fl = new Float32Array(g.attributes.position.count).fill(0.85);
    g.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * 0.16, 0.55 + rnd() * 0.85, Math.sin(a) * 0.16),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.25 + rnd() * 0.4, a + Math.PI / 2, 0)),
      new THREE.Vector3(1 * (0.9 + rnd() * 0.4), 1 * (0.9 + rnd() * 0.4), 1)
    ));
    parts.push({ geo: g, color: new THREE.Color().setRGB(0.75 + rnd() * 0.25, 0.95, 0.8) });
  }
  // stem
  const st = new THREE.CylinderGeometry(0.02, 0.05, 1.6, 5, 4);
  st.translate(0, 0.8, 0);
  const fls = new Float32Array(st.attributes.position.count).fill(0.5);
  st.setAttribute("aFlex", new THREE.BufferAttribute(fls, 1));
  parts.push({ geo: st, color: new THREE.Color(0x5f7a3c) });
  const geo = mergeSimple(parts);

  const spots = [
    { x: 12.5, z: 66, s: 1.5 }, { x: -7.5, z: 63, s: 1.2 },
    { x: 2.0, z: 58.5, s: 1.35 }, { x: 15.5, z: 55, s: 1.1 },
    { x: -11, z: 48, s: 1.25 }, { x: 8.5, z: 45, s: 1.0 },
  ];
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  im.castShadow = true;
  im.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  spots.forEach((p, i) => {
    m4.compose(
      new THREE.Vector3(p.x, heightAtLocal(p.x, p.z) - 0.1, p.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i * 1.7) % (Math.PI * 2), 0)),
      new THREE.Vector3(p.s, p.s, p.s)
    );
    im.setMatrixAt(i, m4);
  });
  im.instanceMatrix.needsUpdate = true;
  im.name = "accent-palmate";
  scene.add(im);

  return { mesh: im };
}

/* ------------------------------------------------------------------ */
/* 7. Rocks + boulders                                                */
/* ------------------------------------------------------------------ */
export function buildRocks(scene, opts = {}) {
  const { count = 260, region = { x0: -160, x1: 160, z0: 60, z1: -230 } } = opts;
  const rnd = mulberry32(4242);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const s = 1.1 + i * 0.25;
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, k);
      const n = fbm(v.x * 1.3 + i * 7, v.z * 1.3 + v.y, 3);
      v.multiplyScalar(1 + n * 0.36);
      v.y *= 0.66;
      p.setXYZ(k, v.x * s, v.y * s, v.z * s);
    }
    g.computeVertexNormals();
    const fl = new Float32Array(p.count).fill(0);
    g.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
    parts.push({ geo: g, color: new THREE.Color().setRGB(0.78 + rnd() * 0.12, 0.76, 0.7) });
  }
  const geos = parts.map((p) => mergeSimple([p]));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    flatShading: true,
  });

  const buckets = [[], [], [], []];
  let guard = 0, n = 0;
  while (n < count && guard < count * 30) {
    guard++;
    const x = region.x0 + rnd() * (region.x1 - region.x0);
    const z = region.z0 + rnd() * (region.z1 - region.z0);
    const r = rnd();
    const b = Math.floor(rnd() * 4);
    buckets[b].push({ x, z, s: r > 0.9 ? 2.2 + rnd() * 4 : 0.22 + rnd() * 1.1, rot: rnd() * 6.28 });
    n++;
  }

  const meshes = [];
  const m4 = new THREE.Matrix4();
  buckets.forEach((list, i) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geos[i], mat, list.length);
    im.castShadow = true;
    im.receiveShadow = true;
    list.forEach((p, k) => {
      m4.compose(
        new THREE.Vector3(p.x, heightAtLocal(p.x, p.z) - p.s * 0.25, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 0.4, p.rot, rnd() * 0.4)),
        new THREE.Vector3(p.s, p.s * (0.7 + rnd() * 0.5), p.s)
      );
      im.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = `rocks-${i}`;
    scene.add(im);
    meshes.push(im);
  });

  return { meshes };
}

/* ------------------------------------------------------------------ */
/* 8. Litter: dry straw & cut stalks on the ground                    */
/* ------------------------------------------------------------------ */
export function buildLitter(scene, opts = {}) {
  const { count = 1800, region = { x0: -55, x1: 55, z0: 34, z1: -50 } } = opts;
  const rnd = mulberry32(808);
  const geo = new THREE.PlaneGeometry(0.5, 0.06, 2, 1);
  geo.rotateX(-Math.PI / 2);
  const fl = new Float32Array(geo.attributes.position.count).fill(0.4);
  geo.setAttribute("aFlex", new THREE.BufferAttribute(fl, 1));
  const mat = applyWind(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    { strength: 0.5, flutter: 0.5 }
  );
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.receiveShadow = true;
  const colors = new Float32Array(count * 3);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const x = region.x0 + rnd() * (region.x1 - region.x0);
    const z = region.z0 + rnd() * (region.z1 - region.z0);
    const s = 0.6 + rnd() * 1.8;
    m4.compose(
      new THREE.Vector3(x, heightAtLocal(x, z) + 0.03, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.2, rnd() * 6.28, (rnd() - 0.5) * 0.15)),
      new THREE.Vector3(s, 1, s)
    );
    im.setMatrixAt(i, m4);
    const t = rnd();
    colors[i * 3] = 0.55 + t * 0.3;
    colors[i * 3 + 1] = 0.46 + t * 0.22;
    colors[i * 3 + 2] = 0.28 + t * 0.14;
  }
  geo.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));
  im.instanceMatrix.needsUpdate = true;
  im.name = "litter";
  scene.add(im);
  return { mesh: im };
}
