import * as THREE from "three";
import { makeCanvas } from "../util/textures.js";

/**
 * Clear-day sky dome: zenith blue -> pale horizon with a warm sun bloom,
 * plus a matching hemispheric light model.
 */
export function buildSky(scene, renderer) {
  const W = 24;
  const H = 256;
  const c = makeCanvas(1);
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, "#1e5ec4");
  g.addColorStop(0.16, "#2f77d6");
  g.addColorStop(0.34, "#5a9ce4");
  g.addColorStop(0.52, "#96c3ee");
  g.addColorStop(0.63, "#c6ddf1");
  g.addColorStop(0.70, "#e2ebef");
  g.addColorStop(0.78, "#eef2ea");
  g.addColorStop(1.0, "#dfe7e2");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;

  const geo = new THREE.SphereGeometry(4000, 48, 32);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = "sky";
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  scene.fog = new THREE.FogExp2(0xbcd3d8, 0.0021);
  scene.background = null;

  return { dome, texture: tex };
}

/** Procedural sun disk + bloom billboard that follows the light direction. */
export function buildSun(scene, dir, color = 0xfff3d4) {
  const group = new THREE.Group();

  const glowCanvas = makeCanvas(256);
  const ctx = glowCanvas.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,246,1)");
  g.addColorStop(0.10, "rgba(255,250,225,0.95)");
  g.addColorStop(0.24, "rgba(255,238,190,0.4)");
  g.addColorStop(0.55, "rgba(255,232,180,0.10)");
  g.addColorStop(1, "rgba(255,232,180,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(glowCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    })
  );
  sprite.scale.setScalar(880);
  sprite.position.copy(dir.clone().multiplyScalar(2600));
  sprite.renderOrder = -5;
  group.add(sprite);

  const disc = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    })
  );
  disc.scale.setScalar(150);
  disc.position.copy(sprite.position);
  disc.renderOrder = -4;
  group.add(disc);

  group.name = "sun";
  scene.add(group);
  return group;
}
