import * as THREE from "three";
import { fbm, ridged, noise2, smoothstep, clamp, mix, mulberry32 } from "./noise.js";

const RAND_SPLAT = mulberry32(4242);
import { makeCanvas, makeDirtDetail, makeGrassDetail, makeRockDetail } from "../util/textures.js";

/** World extends to +/- TERRAIN_HALF; playable basin is much smaller. */
export const TERRAIN_HALF = 620;
const SPLAT_HALF = 170;

/* ------------------------------------------------------------------ */
/* Trail (the dirt path in the foreground)                             */
/* ------------------------------------------------------------------ */
export const TRAIL = [
  new THREE.Vector2(6, 92),
  new THREE.Vector2(5, 72),
  new THREE.Vector2(2.4, 56),
  new THREE.Vector2(-1.4, 44),
  new THREE.Vector2(-4.6, 33),
  new THREE.Vector2(-4.0, 24),
  new THREE.Vector2(0.4, 16),
  new THREE.Vector2(4.2, 9),
  new THREE.Vector2(6.2, 2),
];

const trailSamples = [];
(function sampleTrail() {
  const curve = new THREE.CatmullRomCurve3(
    TRAIL.map((p) => new THREE.Vector3(p.x, 0, p.y)),
    false,
    "catmullrom",
    0.4
  );
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    trailSamples.push({ x: p.x, z: p.z });
  }
})();

// z -> centre x lookup so distance queries stay O(1)
const Z_MIN = -6;
const Z_MAX = 96;
const TRAIL_LUT = new Float32Array(Math.ceil(Z_MAX - Z_MIN) + 1);
(function buildTrailLut() {
  for (let i = 0; i < TRAIL_LUT.length; i++) {
    const z = Z_MIN + i;
    let best = trailSamples[0];
    let bd = 1e9;
    for (const s of trailSamples) {
      const d = Math.abs(s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    TRAIL_LUT[i] = best.x;
  }
})();

export function trailXAt(z) {
  const i = Math.max(0, Math.min(TRAIL_LUT.length - 1, Math.round(z - Z_MIN)));
  return TRAIL_LUT[i];
}

export function trailPoints() {
  return trailSamples;
}

/** Approximate horizontal distance from the trail centreline (metres). */
export function distToTrail(x, z) {
  if (z < Z_MIN - 3 || z > Z_MAX + 6) {
    // beyond the path stub: measure from the nearest endpoint
    const s = z > Z_MAX ? trailSamples[trailSamples.length - 1] : trailSamples[0];
    return Math.hypot(x - s.x, z - s.z);
  }
  const cx = trailXAt(z);
  const dx = x - cx;
  // correct a little for the trail's longitudinal slope
  const cz = trailXAt(z + 1) - trailXAt(z - 1);
  return Math.abs(dx) / Math.sqrt(1 + cz * cz * 0.25);
}

/* ------------------------------------------------------------------ */
/* Height field                                                       */
/* ------------------------------------------------------------------ */
export function heightAt(x, z) {
  // ---- the cultivated shelf the player walks on
  let h = 0;
  h += fbm(x * 0.014, z * 0.014, 4) * 1.1;
  h += fbm(x * 0.055, z * 0.055, 3) * 0.18;
  h += fbm(x * 0.22, z * 0.22, 2) * 0.05;

  // gentle tilt toward the mountains
  const north = smoothstep(20, -80, z);
  h += north * north * 7.5 + north * 3.2;

  // shallow terrace step where the trail runs
  const trail = distToTrail(x, z);
  h -= smoothstep(5.2, 0.6, trail) * 0.4;
  h += smoothstep(3.5, 16, trail) * 0.3;

  // ---- enclosing mountain walls of the valley
  const ringDist = Math.hypot(x * 1.05, (z - 6) * 0.86);
  const rise = smoothstep(52, 300, ringDist);          // 0 on the floor, 1 high on the walls
  const mask = Math.pow(rise, 1.35);
  const northBoost = smoothstep(10, -140, z);
  const ridges = ridged(x * 0.0042 + 11.3, z * 0.0042 - 4.7, 6);
  const ridges2 = ridged(x * 0.0105 - 3.1, z * 0.0105 + 8.4, 4);
  const peak = 70 + 430 * Math.pow(ridges, 1.75) + 70 * ridges2;
  h += mask * peak * (0.5 + 0.62 * northBoost);

  // rolling foothills between the farm and the rock walls
  const foot = smoothstep(58, 200, ringDist);
  h += foot * (8 + 16 * (0.5 + 0.5 * fbm(x * 0.012 + 4, z * 0.012 - 6, 3)));

  // exposed rock faces that climb the northern slope
  const cliffs = smoothstep(0.35, 0.9, rise) * smoothstep(30, -80, z);
  h += cliffs * 55 * Math.pow(Math.max(0, noise2(x * 0.011, z * 0.011)), 1.2);

  // a low ridge closes the valley behind the visitor
  const south = smoothstep(60, 210, z);
  h += south * (10 + 70 * Math.pow(ridged(x * 0.005 + 20, z * 0.005 - 2, 4), 1.4));

  return h;
}

export function slopeAt(x, z, eps = 1.4) {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  const dx = (hR - hL) / (2 * eps);
  const dz = (hU - hD) / (2 * eps);
  return Math.sqrt(dx * dx + dz * dz);
}

/* ------------------------------------------------------------------ */
/* Splat / macro map                                                  */
/* ------------------------------------------------------------------ */
let cachedSplat = null;

export function buildSplatTexture() {
  if (cachedSplat) return cachedSplat;
  const S = 512;
  const c = makeCanvas(S);
  const ctx = c.getContext("2d");
  const step = (2 * SPLAT_HALF) / S;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const toPx = (v) => ((v + SPLAT_HALF) / (2 * SPLAT_HALF)) * S;

  // A: bare earth weight, B: dry/rock weight, G: grass vigour
  for (let py = 0; py < S; py++) {
    const z = (py / S) * 2 * SPLAT_HALF - SPLAT_HALF;
    for (let px = 0; px < S; px++) {
      const x = (px / S) * 2 * SPLAT_HALF - SPLAT_HALF;
      const i = (py * S + px) * 4;
      const n = fbm(x * 0.05, z * 0.05, 4) * 0.5 + 0.5;
      const moisture = clamp(0.5 + fbm(x * 0.11 + 7, z * 0.11 - 3, 3), 0, 1);
      d[i] = Math.round(clamp(0.06 + (fbm(x * 0.09 + 7, z * 0.09 - 3, 3) * 0.5 + 0.5) * 0.2, 0, 1) * 255);
      d[i + 1] = Math.round(clamp(0.35 + n * 0.7, 0, 1) * 255);
      d[i + 2] = Math.round(clamp(fbm(x * 0.12 - 4, z * 0.12 + 9, 3) * 0.5 + 0.5, 0, 1) * 0.22 * 255);
      d[i + 3] = 255;
      void moisture;
      void step;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 2) earth + litter painted around the path and the start terrace
  const paintDirt = (x, z, radius, alpha, wobble = 2.2) => {
    const px = toPx(x);
    const pz = toPx(z);
    const pr = (radius / (2 * SPLAT_HALF)) * S;
    const grd = ctx.createRadialGradient(px, pz, pr * 0.12, px, pz, pr);
    grd.addColorStop(0, `rgba(255,0,0,${alpha})`);
    grd.addColorStop(0.6, `rgba(255,0,0,${alpha * 0.72})`);
    grd.addColorStop(1, "rgba(255,0,0,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(px, pz, pr, 0, Math.PI * 2);
    ctx.fill();
    if (wobble > 0) {
      for (let i = 0; i < 5; i++) {
        const a = RAND_SPLAT() * Math.PI * 2;
        const r = pr * (0.45 + RAND_SPLAT() * 0.7);
        ctx.fillStyle = `rgba(255,0,0,${alpha * 0.35})`;
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * r, pz + Math.sin(a) * r, pr * (0.18 + RAND_SPLAT() * 0.28), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  for (let i = 0; i < trailSamples.length; i++) {
    const s = trailSamples[i];
    paintDirt(s.x, s.z, 2.7 + Math.sin(i * 0.3) * 0.6, 0.95, 1.1);
  }
  paintDirt(4, 52, 7.5, 0.9);
  paintDirt(-1, 44, 5.2, 0.55);
  paintDirt(9, 60, 6, 0.6);
  for (let i = 0; i < 46; i++) {
    const a = RAND_SPLAT() * Math.PI * 2;
    const r = 8 + RAND_SPLAT() * 70;
    paintDirt(Math.cos(a) * r, 42 - RAND_SPLAT() * 92, 1.6 + RAND_SPLAT() * 6, 0.18 + RAND_SPLAT() * 0.42, 1);
  }
  for (let x = -70; x < 70; x += 2.4) {
    paintDirt(x, 22 + Math.sin(x * 0.13) * 4, 1.2 + RAND_SPLAT() * 2.6, 0.16 + RAND_SPLAT() * 0.3, 1);
  }

  // 3) rock exposure on steeper ground (B), which also thins the grass (G)
  const img2 = ctx.getImageData(0, 0, S, S);
  const d2 = img2.data;
  const heightGrid = new Float32Array(S * S);
  for (let py = 0; py < S; py++) {
    const z = (py / S) * 2 * SPLAT_HALF - SPLAT_HALF;
    for (let px = 0; px < S; px++) {
      const x = (px / S) * 2 * SPLAT_HALF - SPLAT_HALF;
      heightGrid[py * S + px] = heightAt(x, z);
    }
  }
  const cell = (2 * SPLAT_HALF) / S;
  for (let py = 1; py < S - 1; py++) {
    for (let px = 1; px < S - 1; px++) {
      const hl = heightGrid[py * S + px - 1];
      const hr = heightGrid[py * S + px + 1];
      const hd = heightGrid[(py - 1) * S + px];
      const hu = heightGrid[(py + 1) * S + px];
      const slope = Math.hypot((hr - hl) / (2 * cell), (hu - hd) / (2 * cell));
      const rockv = smoothstep(0.45, 1.05, slope) * 255;
      const i = (py * S + px) * 4;
      d2[i + 2] = Math.max(d2[i + 2], rockv);
      d2[i + 1] = Math.min(d2[i + 1], 255 - rockv * 0.8);
      // steep faces keep their earth colour visible under the rock blend
      d2[i] = Math.max(d2[i], rockv * 0.35);
    }
  }
  ctx.putImageData(img2, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  cachedSplat = tex;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Ground material with 3-way texture blending                        */
/* ------------------------------------------------------------------ */
export function makeGroundMaterial(splatTex) {
  const grass = makeGrassDetail(512);
  const dirt = makeDirtDetail(512);
  const rock = makeRockDetail(512);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    dithering: true,
    vertexColors: true,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSplat = { value: splatTex };
    shader.uniforms.uGrass = { value: grass.map };
    shader.uniforms.uGrassN = { value: grass.normalMap };
    shader.uniforms.uDirt = { value: dirt.map };
    shader.uniforms.uDirtN = { value: dirt.normalMap };
    shader.uniforms.uRock = { value: rock.map };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        uniform sampler2D uSplat, uGrass, uGrassN, uDirt, uDirtN, uRock;
        float gBlend; vec2 gUv; vec2 gUv2;`
      )
      .replace(
        "#include <map_fragment>",
        `
        vec2 splatUv = (vWPos.xz + ${SPLAT_HALF.toFixed(1)}) / ${(2 * SPLAT_HALF).toFixed(1)};
        vec3 splat = texture2D(uSplat, clamp(splatUv, 0.001, 0.999)).rgb;
        float dirtW = smoothstep(0.05, 0.62, splat.r);
        float rockW = smoothstep(0.05, 0.55, splat.b);
        float grassW = clamp(splat.g, 0.0, 1.0);

        gUv = vWPos.xz * 0.42;
        gUv2 = vWPos.xz * 0.083;
        vec3 cGrass = texture2D(uGrass, gUv).rgb * texture2D(uGrass, gUv2).rgb * 2.0;
        vec3 cDirt  = texture2D(uDirt, gUv).rgb * texture2D(uDirt, gUv2 * 1.9).rgb * 2.0;
        vec3 cRock  = texture2D(uRock, vWPos.xz * 0.09).rgb * 0.62 + texture2D(uRock, vWPos.xz * 0.021).rgb * 0.55;

        // scattered wildflowers & gravel speckles from the high-frequency channels
        float speck = texture2D(uGrass, vWPos.xz * 2.7).b;
        float flower = smoothstep(0.72, 0.9, texture2D(uGrass, vWPos.xz * 1.9).r);
        vec3 flowerCol = mix(vec3(0.95, 0.9, 0.55), vec3(0.98, 0.96, 0.92), speck);
        cGrass = mix(cGrass, flowerCol * 1.1, flower * 0.5 * (1.0 - dirtW));

        float macro = 0.86 + 0.3 * texture2D(uGrass, vWPos.xz * 0.006).g;
        vec3 base = mix(cGrass * vec3(0.74, 1.0, 0.6), cDirt * vec3(1.0, 0.92, 0.8), dirtW);
        base = mix(base, cRock * vec3(1.02, 1.0, 0.94), rockW * 0.92);
        base *= macro * grassW;

        // sun-dried straw band along the field edge
        float straw = smoothstep(0.3, 0.8, splat.b) * smoothstep(0.2, 0.65, splat.r);
        base = mix(base, base * vec3(1.5, 1.22, 0.55), straw * 0.55);

        diffuseColor.rgb *= base;
        gBlend = clamp(dirtW + rockW * 0.7, 0.0, 1.0);
        `
      )
      .replace(
        "#include <normal_fragment_maps>",
        `
        vec3 nDirt = texture2D(uDirtN, gUv).xyz * 2.0 - 1.0;
        vec3 nGrass = texture2D(uGrassN, gUv).xyz * 2.0 - 1.0;
        vec3 nMix = normalize(mix(nGrass, nDirt, gBlend) + vec3(0.0, 0.0, 1.0) * 0.7);
        vec3 nPerturb = (viewMatrix * vec4(nMix.x, 0.0, nMix.y, 0.0)).xyz;
        normal = normalize(normal + nPerturb * 0.85);
        `
      );
  };

  return mat;
}

/* ------------------------------------------------------------------ */
/* Mesh construction: single warped grid, dense near the visitor      */
/* ------------------------------------------------------------------ */
export function buildTerrain(scene, quality = "high") {
  const segs = { low: 200, medium: 300, high: 400, ultra: 520 }[quality] ?? 400;
  const geo = new THREE.PlaneGeometry(2, 2, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const power = 3.1;

  const warp = (u) => Math.sign(u) * Math.pow(Math.abs(u), power) * TERRAIN_HALF;

  for (let i = 0; i < count; i++) {
    const u = pos.getX(i);
    const v = pos.getZ(i);
    const x = warp(u);
    const z = warp(v);
    const y = heightAt(x, z);
    pos.setXYZ(i, x, y, z);
  }

  // colour per-vertex: greens low, dry gold mid-slope, grey rock high/steep
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const slope = slopeAt(x, z, Math.max(1.2, Math.abs(x) * 0.004 + Math.abs(z) * 0.004));
    const moist = clamp(0.5 + fbm(x * 0.02, z * 0.02, 3), 0, 1);
    const rock = clamp(smoothstep(0.55, 1.5, slope) + smoothstep(85, 190, y), 0, 1);
    const dry = clamp(smoothstep(24, 90, y) * (1.0 - rock) + smoothstep(0.4, 1.0, slope) * 0.35, 0, 1);

    let r = mix(0.34, 0.66, dry);
    let g = mix(0.62, 0.62, dry);
    let b = mix(0.24, 0.33, dry);
    // rock
    r = mix(r, 0.56, rock);
    g = mix(g, 0.54, rock);
    b = mix(b, 0.48, rock);
    // subtle moisture darkening in the shaded hollows
    const shade = 0.86 + 0.2 * moist;
    colors[i * 3] = r * shade;
    colors[i * 3 + 1] = g * shade;
    colors[i * 3 + 2] = b * shade;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const splat = buildSplatTexture();
  const mat = makeGroundMaterial(splat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "ground";
  scene.add(mesh);

  return { mesh, splat, material: mat };
}

/** Cheap height + normal probe for the character controller. */
export function groundSample(x, z) {
  return heightAt(x, z);
}
