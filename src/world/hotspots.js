import * as THREE from "three";
import { heightAt } from "./terrain.js";
import { STATIONS } from "../data/stations.js";

/**
 * Floating markers for the five field stations: a soft ground ring, a rising
 * mote of light, and a billboarded label. They gently pulse and fade with
 * distance so they never fight the scenery.
 */
export function buildHotspots(scene, camera) {
  const group = new THREE.Group();
  group.name = "hotspots";
  scene.add(group);

  const ringGeo = new THREE.RingGeometry(0.72, 0.98, 48);
  ringGeo.rotateX(-Math.PI / 2);

  const items = STATIONS.map((s, i) => {
    const y = heightAt(s.pos[0], s.pos[1]);
    const root = new THREE.Group();
    root.position.set(s.pos[0], y + 0.04, s.pos[1]);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd6f2b6,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 3;
    root.add(ring);

    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x9fe07c,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32).rotateX(-Math.PI / 2), innerMat);
    disc.position.y = 0.01;
    root.add(disc);

    // light mote
    const moteMat = new THREE.SpriteMaterial({
      color: 0xe8ffd2,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mote = new THREE.Sprite(moteMat);
    mote.scale.setScalar(0.55);
    mote.position.y = 1.5;
    root.add(mote);

    group.add(root);
    return { station: s, root, ring, ringMat, innerMat, mote, moteMat, index: i, phase: i * 1.3 };
  });

  const tmp = new THREE.Vector3();
  let time = 0;

  return {
    items,
    group,
    update(dt, playerPos, activeIndex = -1) {
      time += dt;
      for (const it of items) {
        const p = it.root.position;
        const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
        const near = Math.max(0, 1 - d / 26);
        const isActive = it.index === activeIndex;
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.8 + it.phase);
        it.ringMat.opacity = (isActive ? 0.85 : 0.12 + near * 0.5) * (0.62 + pulse * 0.38);
        it.innerMat.opacity = (isActive ? 0.24 : 0.02 + near * 0.12) * (0.5 + pulse * 0.5);
        it.ring.scale.setScalar(1 + pulse * 0.055 + near * 0.05);
        it.mote.position.y = 1.35 + Math.sin(time * 1.1 + it.phase) * 0.22;
        it.moteMat.opacity = (isActive ? 0.95 : 0.1 + near * 0.6) * (0.6 + pulse * 0.4);
        it.mote.scale.setScalar(0.45 + near * 0.35 + pulse * 0.1);
        it.root.visible = d < 140;
      }
      void camera;
      void tmp;
    },
  };
}
