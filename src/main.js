import "./style.css";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

import { buildTerrain, heightAt, trailXAt } from "./world/terrain.js";
import { buildSky, buildSun } from "./world/sky.js";
import {
  windUniforms,
  bindTerrainSamplers,
  buildBananaField,
  buildGrassField,
  buildShrubs,
  buildTrees,
  buildAccentPlants,
  buildRocks,
  buildLitter,
} from "./world/vegetation.js";
import { buildHotspots } from "./world/hotspots.js";
import { Walker } from "./controls/walker.js";
import { Ambience } from "./audio/ambience.js";
import { InfoPanel } from "./ui/panel.js";
import { STATIONS, TOUR_SEQUENCE } from "./data/stations.js";

bindTerrainSamplers(heightAt, trailXAt);

/* ------------------------------------------------------------------ */
/* DOM refs                                                           */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const intro = $("intro");
const hud = $("hud");
const loaderBar = $("loader-bar");
const loaderPct = $("loader-pct");
const loaderText = $("loader-text");
const btnEnter = $("btn-enter");
const btnTour = $("btn-tour");

const setProgress = (pct, text) => {
  loaderBar.style.width = `${Math.round(pct)}%`;
  loaderPct.textContent = `${Math.round(pct)}%`;
  if (text) loaderText.textContent = text;
};

/* ------------------------------------------------------------------ */
/* Renderer / scene                                                   */
/* ------------------------------------------------------------------ */
const settings = {
  quality: "high",
  fog: 52,
  sens: 100,
  vol: 65,
  wind: 70,
  shadows: true,
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    stencil: false,
  });
} catch (err) {
  $("fatal").classList.remove("hidden");
  intro.classList.add("gone");
  throw err;
}

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.6 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.08, 5200);

/* ---- sky, sun, lights ---- */
const sky = buildSky(scene, renderer);
const SUN_DIR = new THREE.Vector3(-0.42, 0.62, -0.66).normalize();
buildSun(scene, SUN_DIR, 0xfff0cc);

const sun = new THREE.DirectionalLight(0xfff2d8, 3.05);
sun.position.copy(SUN_DIR.clone().multiplyScalar(120));
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
const S = 46;
sun.shadow.camera.left = -S;
sun.shadow.camera.right = S;
sun.shadow.camera.top = S;
sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.045;
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0xa9d4f2, 0x506430, 1.05);
scene.add(hemi);

const bounce = new THREE.DirectionalLight(0xbfe08f, 0.35);
bounce.position.set(0.5, -0.2, 0.7);
scene.add(bounce);

/* ------------------------------------------------------------------ */
/* Build the world progressively so the loader can report progress    */
/* ------------------------------------------------------------------ */
const world = {
  terrain: null,
  hotspots: null,
  banana: null,
  trees: null,
  ready: false,
};

async function buildWorld() {
  const step = async (pct, text, fn) => {
    setProgress(pct, text);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 12)));
    return fn();
  };

  world.terrain = await step(6, "تشكيل التضاريس والمنحدرات…", () => buildTerrain(scene, settings.quality));
  world.banana = await step(28, "زرع حقل الموز…", () =>
    buildBananaField(scene, {
      count: isMobile ? 170 : 300,
      region: { x0: -50, x1: 50, z0: 30, z1: -52 },
      minSpacing: isMobile ? 3.0 : 2.35,
      heightRange: [2.0, 3.6],
    })
  );

  await step(48, "توليد الأعشاب والغطاء الأرضي…", () => {
    buildGrassField(scene, { count: isMobile ? 2200 : 5200, tuftHeight: "short", seed: 3 });
    buildGrassField(scene, { count: isMobile ? 500 : 1400, tuftHeight: "tall", seed: 9, region: { x0: -52, x1: 52, z0: 34, z1: -60 } });
    buildLitter(scene, { count: isMobile ? 700 : 2000 });
  });

  await step(66, "بسط الشجيرات والأشجار…", () => {
    buildShrubs(scene, { count: isMobile ? 120 : 280 });
    world.trees = buildTrees(scene, { count: isMobile ? 55 : 120 });
    buildAccentPlants(scene);
  });

  await step(80, "نحت الصخور ووضع المحطات…", () => {
    buildRocks(scene, { count: isMobile ? 140 : 340 });
    world.hotspots = buildHotspots(scene, camera);
  });

  await step(92, "ضبط الإضاءة والمسارات…", () => {
    // solid stems: you can't walk through the bananas nearest the path
    for (const p of world.banana.placed) {
      const d = Math.abs(p.x - trailXAt(p.z));
      if (d < 22) walker.addCollider(p.x, p.z, 0.34);
    }
    walker.noLock = isMobile;
  });

  world.ready = true;
  window.__valley = {
    scene, camera, walker, renderer, sun, hemi, ambience, panel, settings,
    stations: STATIONS, hotspotDebug: world.hotspots, world,
    view(x, z, yaw, pitch = -0.04) {
      walker.setPosition(x, z, yaw, pitch);
      walker.update(0.016);
      const y = heightAt(x, z) + 1.66;
      camera.position.set(x, y, z);
      camera.rotation.set(pitch, yaw, 0, "YXZ");
      window.__render && window.__render();
    },
    lookAt(px, pz, tx, ty, tz) {
      const y = heightAt(px, pz) + 1.66;
      camera.position.set(px, y, pz);
      camera.lookAt(tx, ty, tz);
      walker.position.set(px, y - 1.66, pz);
      window.__render && window.__render();
    },
    stats() {
      let tris = 0;
      let objects = 0;
      scene.traverse((o) => {
        if (o.isMesh || o.isInstancedMesh) {
          objects++;
          const g = o.geometry;
          const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
          tris += n * (o.isInstancedMesh ? o.count : 1);
        }
      });
      return { triangles: Math.round(tris), objects, calls: renderer.info.render.calls };
    },
  };
  setProgress(100, "جاهز للتجول");
  btnEnter.disabled = false;
  btnTour.disabled = false;
  btnEnter.querySelector(".btn-label").textContent = "ابدأ التجول";
}

/* ------------------------------------------------------------------ */
/* Controls, audio, UI                                                */
/* ------------------------------------------------------------------ */
const ambience = new Ambience();
const panel = new InfoPanel({
  onNext: () => goToStation((panel.current + 1) % STATIONS.length, true),
  onClose: () => { activeStation = -1; updateLockHint(); },
});

const walker = new Walker(camera, canvas, {
  bounds: { x0: -86, x1: 86, z0: -78, z1: 88 },
  onLockChange: (locked) => {
    $("crosshair").classList.toggle("off", !locked && !isMobile);
    updateLockHint();
  },
  onStep: (running) => {
    ambience.step(running);
    camShake( running ? 0.045 : 0.028 );
  },
});
walker.setPosition(4.5, 62, 0.05, -0.04);

let activeStation = -1;
let tourActive = false;
let tourIndex = 0;
let tourTime = 0;
const TOUR_HOLD = 6.2;
let photoMode = false;
let started = false;
let shake = 0;
function camShake(v) { shake = Math.max(shake, v); }

/* ---- intro ---- */
btnEnter.addEventListener("click", async () => {
  await ambience.start();
  intro.classList.add("gone");
  started = true;
  $("mobile").classList.toggle("hidden", !isMobile);
  sizeRenderer();
  startCinematic();
});

btnTour.addEventListener("click", async () => {
  await ambience.start();
  intro.classList.add("gone");
  hud.classList.remove("hidden");
  started = true;
  walker.enabled = true;
  $("mobile").classList.toggle("hidden", !isMobile);
  startTour();
  sizeRenderer();
});

$("btn-help-intro").addEventListener("click", () => $("help").classList.remove("hidden"));

/* ---- HUD buttons ---- */
document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const a = btn.dataset.action;
    if (a === "tour") startTour();
    if (a === "free") stopTour();
    if (a === "sound") {
      ambience.setMuted(!ambience.muted);
      btn.classList.toggle("on", !ambience.muted);
      btn.textContent = ambience.muted ? "🔇" : "🔊";
    }
    if (a === "photo") togglePhoto(!photoMode);
    if (a === "settings") $("settings").classList.remove("hidden");
    if (a === "help") $("help").classList.remove("hidden");
    if (a === "atlas") {
      $("atlas").classList.toggle("hidden");
      renderAtlasPins();
    }
  });
});
document.querySelectorAll("[data-close]").forEach((b) => {
  b.addEventListener("click", () => $(b.dataset.close).classList.add("hidden"));
});

/* ---- cinematic flythrough (auto-played on entry) ---- */
const CINE = [
  {
    from: [4.4, 70], to: [4.0, 55], look: [-1, 26, -60], title: "المدخل الترابي",
    label: "المحطة 1 من 4 · المدخل", note: "الممر الترابي يفتح المشهد على الخضرة والقمم",
  },
  {
    from: [3.2, 46], to: [-1.6, 33], look: [-4, 12, -40], title: "حافة الأعشاب",
    label: "المحطة 2 من 4 · الأعشاب", note: "سيقان ليفية تحرس المنحدر",
  },
  {
    from: [-0.6, 26], to: [-4.2, 12], look: [-14, 7, -30], title: "داخل حقل الموز",
    label: "المحطة 3 من 4 · الموز", note: "أوراق عريضة تفلتر ضوء الظهيرة",
  },
  {
    from: [8, -2], to: [14.5, -22], look: [0, 60, -170], title: "المنظور المرتفع",
    label: "المحطة 4 من 4 · السفوح والقمم", note: "غابات السفوح ثم الكتلة الصخرية",
  },
];
let cineActive = false;
let cineIndex = 0;
let cineT = 0;
const CINE_DUR = 9.5;

function startCinematic() {
  cineActive = true;
  cineIndex = 0;
  cineT = 0;
  started = true;
  tourActive = false;
  walker.enabled = false;
  const el = $("cine");
  el.classList.remove("hidden", "done");
  showCine(0);
}

function showCine(i) {
  const c = CINE[i];
  if (!c) return;
  $("cine-label").textContent = c.label;
  $("cine-title").textContent = c.title;
  const note = document.querySelector("#cine .cine-note");
  if (note) note.textContent = c.note;
  $("cine-fill").style.width = "0%";
}

function endCinematic(skipToFree = true) {
  if (!cineActive) return;
  cineActive = false;
  const el = $("cine");
  el.classList.add("done");
  setTimeout(() => el.classList.add("hidden"), 800);
  walker.enabled = true;
  if (skipToFree) {
    walker.setPosition(4.5, 62, 0.05, -0.04);
    showZone("المدخل الترابي", "النقطة (أ) · ممر التربة والرطوبة");
    if (!isMobile) setTimeout(() => walker.lock(), 260);
  }
  hud.classList.remove("hidden");
  updateLockHint();
}

function updateCinematic(dt) {
  const c = CINE[cineIndex];
  if (!c) return endCinematic();
  cineT += dt / CINE_DUR;
  const k = Math.min(1, cineT);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const x = c.from[0] + (c.to[0] - c.from[0]) * e;
  const z = c.from[1] + (c.to[1] - c.from[1]) * e;
  const y = heightAt(x, z) + 1.72 + Math.sin(cineT * Math.PI) * 0.18;
  camera.position.set(x, y, z);
  // ease the look target too, with a slight breathing motion
  const [lx, ly, lz] = c.look;
  camera.lookAt(lx + Math.sin(cineT * 3.1) * 3.5, ly + Math.sin(cineT * 2.2) * 1.6, lz);
  $("cine-fill").style.width = `${Math.round(k * 100)}%`;
  walker.position.set(x, y - 1.66, z);
  if (k >= 1) {
    cineIndex++;
    cineT = 0;
    if (cineIndex >= CINE.length) {
      endCinematic();
    } else {
      showCine(cineIndex);
    }
  }
}

$("cine").addEventListener("pointerdown", () => endCinematic());
window.addEventListener("keydown", (e) => {
  if (cineActive && (e.key === "Escape" || e.key === "Enter" || e.key === " ")) endCinematic();
});

function updateLockHint() {
  const el = $("lock-hint");
  if (!el) return;
  const show = started && !isMobile && !walker.locked && !panel.isOpen && !photoMode && !tourActive && !cineActive;
  el.classList.toggle("show", show);
}

$("lock-hint").addEventListener("click", () => {
  if (!isMobile) walker.lock();
});

/* ---- keyboard shortcuts ---- */
window.addEventListener("keydown", (e) => {
  if (intro.classList.contains("gone") === false) {
    if (e.key === "Enter" && !btnEnter.disabled) btnEnter.click();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "e") interact();
  if (k === "t") startTour();
  if (k === "p") togglePhoto(!photoMode);
  if (k === "m") {
    ambience.setMuted(!ambience.muted);
    const b = document.querySelector('[data-action="sound"]');
    b.classList.toggle("on", !ambience.muted);
    b.textContent = ambience.muted ? "🔇" : "🔊";
  }
  if (k === "escape") {
    if (tourActive) stopTour();
    $("help").classList.add("hidden");
    $("settings").classList.add("hidden");
    if (photoMode) togglePhoto(false);
  }
  if (k === "i") {
    $("atlas").classList.toggle("hidden");
    renderAtlasPins();
  }
});

/* ---- settings wiring ---- */
$("set-fog").addEventListener("input", (e) => {
  settings.fog = +e.target.value;
  scene.fog.density = 0.0007 + (1 - settings.fog / 100) * 0.0055;
});
$("set-sens").addEventListener("input", (e) => {
  settings.sens = +e.target.value;
  walker.sensitivity = settings.sens / 100;
});
$("set-vol").addEventListener("input", (e) => {
  settings.vol = +e.target.value;
  ambience.setVolume(settings.vol / 100);
});
$("set-wind").addEventListener("input", (e) => {
  settings.wind = +e.target.value;
  windUniforms.uWind.value = settings.wind / 100;
});
$("set-shadows").addEventListener("change", (e) => {
  settings.shadows = e.target.checked;
  renderer.shadowMap.enabled = settings.shadows;
  sun.castShadow = settings.shadows;
  scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
});
$("set-quality").addEventListener("change", (e) => {
  settings.quality = e.target.value;
  const pr = { low: 0.75, medium: 1.0, high: 1.4, ultra: 2 }[settings.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pr));
  composer.setSize(window.innerWidth, window.innerHeight);
  sizeRenderer();
});

/* ---- photo mode ---- */
function togglePhoto(on) {
  photoMode = on;
  $("photo-ui").classList.toggle("hidden", !on);
  document.querySelector('[data-action="photo"]').classList.toggle("on", on);
  $("crosshair").classList.toggle("off", on);
  $("prompt").classList.add("hidden");
  updateLockHint();
  if (on) {
    walker.unlock();
    // free-fly framing: keep the player still but let the mouse aim
    walker.enabled = true;
  }
}
$("photo-shot").addEventListener("click", () => shot());
$("photo-exit").addEventListener("click", () => togglePhoto(false));
function shot() {
  const flash = $("flash");
  flash.classList.remove("go");
  void flash.offsetWidth;
  flash.classList.add("go");
  try {
    renderer.render(scene, camera);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qaswat60-${Date.now()}.jpg`;
    a.click();
  } catch (e) {
    console.warn("capture failed", e);
  }
}

/* ---- stations ---- */
const promptEl = $("prompt");
const promptText = $("prompt-text");

function nearestStation() {
  let best = -1;
  let bd = 5.2;
  for (let i = 0; i < STATIONS.length; i++) {
    const [x, z] = STATIONS[i].pos;
    const d = Math.hypot(walker.position.x - x, walker.position.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function interact() {
  if (panel.isOpen) {
    panel.hide();
    activeStation = -1;
    updateLockHint();
    return;
  }
  const idx = nearestStation();
  if (idx >= 0) {
    activeStation = idx;
    panel.show(idx);
    ambience.step(false);
    walker.unlock();
    updateLockHint();
  } else {
    showZone("لا توجد محطة قريبة", "اقترب من الحلقات المضيئة واضغط E");
  }
}

function goToStation(idx, open = true) {
  const s = STATIONS[idx];
  if (!s) return;
  tourActive = false;
  tourCaption.classList.add("hidden");
  walker.enabled = true;
  // stand a few metres south of the marker, facing it
  const fromX = s.pos[0] + 2.4;
  const fromZ = s.pos[1] + 6.2;
  smoothMoveTo(fromX, fromZ, Math.atan2(fromX - s.pos[0], fromZ - s.pos[1]), -0.08, 1.1);
  activeStation = idx;
  if (open) setTimeout(() => panel.show(idx), 900);
}

/* ---- guided tour ---- */
const tourCaption = $("tour-caption");
function startTour() {
  panel.hide();
  tourActive = true;
  tourIndex = 0;
  tourTime = 0;
  walker.enabled = false;
  walker.unlock();
  $("atlas").classList.add("hidden");
  updateLockHint();
  runTourStep();
}
function runTourStep() {
  const s = TOUR_SEQUENCE[tourIndex];
  if (!s) return stopTour();
  $("tour-step").textContent = `المحطة ${tourIndex + 1} من ${TOUR_SEQUENCE.length}`;
  $("tour-title").textContent = s.title;
  $("tour-text").textContent = s.text;
  tourCaption.classList.remove("hidden");
  $("tour-progress-fill").style.width = "0%";
  const yaw = Math.atan2(s.pos[0] - s.look[0], s.pos[1] - s.look[1]);
  smoothMoveTo(s.pos[0], s.pos[1], yaw, -0.02, 3.4);
  tourTime = 0;
  showZone(s.title, s.text.slice(0, 78) + "…");
}
function stopTour() {
  tourActive = false;
  updateLockHint();
  tourCaption.classList.add("hidden");
  walker.enabled = true;
  activeStation = -1;
}
function nextTourStep() {
  tourIndex++;
  if (tourIndex >= TOUR_SEQUENCE.length) {
    stopTour();
    showZone("انتهت الجولة", "يمكنك مواصلة الاستكشاف بحرية");
    return;
  }
  runTourStep();
}

/* ---- smooth camera traversal ---- */
let transition = null;
function smoothMoveTo(x, z, yaw, pitch, duration) {
  transition = {
    t: 0,
    duration,
    from: { x: walker.position.x, z: walker.position.z, yaw: walker.yaw, pitch: walker.pitch },
    to: { x, z, yaw, pitch },
  };
  // shortest yaw path
  let dy = yaw - walker.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  transition.to.yaw = walker.yaw + dy;
}
function updateTransition(dt) {
  if (!transition) return;
  transition.t += dt;
  const k = Math.min(1, transition.t / transition.duration);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const f = transition.from;
  const t = transition.to;
  const x = f.x + (t.x - f.x) * e;
  const z = f.z + (t.z - f.z) * e;
  walker.setPosition(x, z, f.yaw + (t.yaw - f.yaw) * e, f.pitch + (t.pitch - f.pitch) * e);
  if (tourActive) $("tour-progress-fill").style.width = `${Math.round(e * 100)}%`;
  if (k >= 1) transition = null;
}

/* ---- zone toast ---- */
let zoneTimer = 0;
function showZone(title, sub) {
  const el = $("zone-toast");
  el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ""}`;
  el.classList.add("show");
  clearTimeout(zoneTimer);
  zoneTimer = setTimeout(() => el.classList.remove("show"), 4200);
}

/* ---- atlas ---- */
function renderAtlasPins() {
  const g = $("atlas-pins");
  if (!g) return;
  g.innerHTML = "";
  const mapX = (x) => 100 + (x / 90) * 74;
  const mapY = (z) => 250 - ((z + 80) / 170) * 226;
  STATIONS.forEach((s, i) => {
    const cx = mapX(s.pos[0]);
    const cy = mapY(s.pos[1]);
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("class", "atlas-pin");
    el.innerHTML = `<circle cx="${cx}" cy="${cy}" r="9" fill="#9be07f" opacity="0.22"/>
      <circle cx="${cx}" cy="${cy}" r="5" fill="#d9f7c2"/>
      <text x="${cx}" y="${cy + 2.6}">${i + 1}</text>`;
    el.addEventListener("click", () => {
      $("atlas").classList.add("hidden");
      goToStation(i, true);
    });
    g.appendChild(el);
  });
}
$("atlas-close").addEventListener("click", () => $("atlas").classList.add("hidden"));

/* ---- mobile stick ---- */
if (isMobile) {
  const stick = $("stick");
  const knob = $("stick-knob");
  let id = null;
  const R = 42;
  const setKnob = (dx, dy) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  stick.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    id = t.identifier;
    e.preventDefault();
  }, { passive: false });
  stick.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== id) continue;
      const r = stick.getBoundingClientRect();
      let dx = t.clientX - (r.left + r.width / 2);
      let dy = t.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      setKnob(dx, dy);
      walker.setTouchMove(dx / R, dy / R);
    }
    e.preventDefault();
  }, { passive: false });
  const end = () => { id = null; setKnob(0, 0); walker.setTouchMove(0, 0); };
  stick.addEventListener("touchend", end);
  stick.addEventListener("touchcancel", end);
  $("act-btn").addEventListener("click", () => interact());
}

/* ------------------------------------------------------------------ */
/* Post processing                                                    */
/* ------------------------------------------------------------------ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.2, 0.55, 0.94);
composer.addPass(bloom);

const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.72 },
    uWarm: { value: 1.0 },
    uSat: { value: 1.06 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uWarm, uSat, uTime;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // gentle filmic contrast
      c = clamp((c - 0.5) * 1.045 + 0.5, 0.0, 1.0);
      // saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // warm highlights, cool shadows
      c += vec3(0.024, 0.012, -0.012) * smoothstep(0.55, 1.0, l) * uWarm;
      c += vec3(-0.012, 0.0, 0.022) * (1.0 - smoothstep(0.0, 0.45, l));
      // vignette
      vec2 d = vUv - 0.5;
      float v = 1.0 - uVignette * dot(d, d) * 1.05;
      c *= v;
      // subtle grain
      float n = fract(sin(dot(vUv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.012;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

window.__render = () => composer.render();

function sizeRenderer() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
}
window.addEventListener("resize", sizeRenderer);

/* ------------------------------------------------------------------ */
/* Loop                                                               */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let fpsAcc = 0;
let fpsFrames = 0;
const compass = document.querySelector(".compass-strip");
const tmpV = new THREE.Vector3();

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  windUniforms.uTime.value += dt * 1.0;
  windUniforms.uWind.value = settings.wind / 100;

  if (!world.ready) {
    renderer.render(scene, camera);
    return;
  }

  // idle cinematic drift while the intro overlay is still up
  if (cineActive) {
    updateCinematic(dt);
    ambience.update(dt, { moving: 0.2, nearGrass: 0.3, wind: settings.wind / 100 });
    if (world.hotspots) world.hotspots.update(dt, walker.position, -1);
    sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.copy(SUN_DIR).multiplyScalar(120).add(sun.target.position);
    sun.target.updateMatrixWorld();
    sky.dome.position.copy(camera.position);
    grade.uniforms.uTime.value += dt * 0.5;
    composer.render();
    return;
  }

  if (!started) {
    const t = clock.elapsedTime;
    const z = 64 - (t * 0.55) % 26;
    const x = 5.2 + Math.sin(t * 0.18) * 2.6;
    camera.position.set(x, heightAt(x, z) + 1.9 + Math.sin(t * 0.4) * 0.08, z);
    camera.lookAt(-1 + Math.sin(t * 0.12) * 3, heightAt(0, -120) + 34, -120);
    renderer.render(scene, camera);
    return;
  }

  updateTransition(dt);
  if (!transition) walker.update(dt);
  else walker._apply();

  // keep the shadow frustum around the player
  sun.target.position.set(walker.position.x, walker.position.y, walker.position.z);
  sun.position.copy(SUN_DIR).multiplyScalar(120).add(sun.target.position);
  sun.target.updateMatrixWorld();
  sky.dome.position.set(camera.position.x, camera.position.y * 0.2, camera.position.z);

  if (shake > 0) {
    shake = Math.max(0, shake - dt * 0.35);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }

  const nearGrass = grassProximity();
  ambience.update(dt, {
    moving: Math.min(1, walker.speed / 4),
    nearGrass,
    wind: settings.wind / 100,
  });

  // hotspots + prompts
  const idx = nearestStation();
  if (world.hotspots) world.hotspots.update(dt, walker.position, idx >= 0 ? idx : activeStation);
  const hot = idx >= 0 && !panel.isOpen && !tourActive;
  $("crosshair").classList.toggle("hot", hot);
  promptEl.classList.toggle("hidden", !hot);
  if (hot) promptText.textContent = `${STATIONS[idx].name} — تفاعل`;
  const actBtn = $("act-btn");
  if (actBtn) actBtn.disabled = !hot;

  // zone label
  const zone = zoneForPosition();
  if (zone && zone !== currentZone) {
    currentZone = zone;
    $("zone-label").textContent = zone;
    showZone(zone, zoneSub(zone));
  }

  // compass
  if (compass) {
    const deg = ((-walker.yaw * 180) / Math.PI) % 360;
    compass.style.backgroundPosition = `${deg * 0.55}px 0`;
  }

  // tour advance
  if (tourActive && !transition) {
    tourTime += dt;
    if (tourTime > TOUR_HOLD) {
      tourTime = 0;
      nextTourStep();
    }
  }

  if (photoMode) {
    $("crosshair").classList.add("off");
  }

  grade.uniforms.uTime.value += dt * 0.5;
  composer.render();

  // fps
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 0.6) {
    const el = $("fps");
    if (el) el.textContent = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0;
    fpsFrames = 0;
  }
  void tmpV;
}

let currentZone = "";
function zoneForPosition() {
  const { x, z } = walker.position;
  if (z > 40) return "المدخل الترابي";
  if (z > 18 && Math.abs(x) < 24) return "حافة الأعشاب";
  if (z > -20) return "قلب حقل الموز";
  if (z > -50) return "سفوح الأشجار";
  return "مشرف القمم";
}
function zoneSub(z) {
  if (z === "المدخل الترابي") return "أرض رسوبية دافئة تحت أشعة الصباح";
  if (z === "حافة الأعشاب") return "غطاء ليفي مثبِّت للتربة";
  if (z === "قلب حقل الموز") return "ظلال متغيّرة وأوراق شفافة";
  if (z === "سفوح الأشجار") return "مظلة كاسرة للرياح";
  return "إطلالة على الكتلة الصخرية";
}

function grassProximity() {
  // approximate: closer to tall-grass band and lower on the slope -> louder swish
  const z = walker.position.z;
  const band = Math.max(0, 1 - Math.abs(z - 26) / 22);
  return Math.min(1, band * 0.9 + Math.abs(Math.sin(walker.position.x * 0.05)) * 0.2);
}

/* ---- PWA: install prompt + offline cache (only when served over http/https) ---- */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = document.createElement("button");
  btn.className = "tool install-btn";
  btn.textContent = "⬇ تثبيت";
  btn.title = "تثبيت التجربة كتطبيق على الجهاز";
  btn.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    btn.remove();
  });
  document.querySelector(".tools")?.prepend(btn);
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  });
}

/* ---- kick off ---- */
sizeRenderer();
buildWorld().then(() => {
  // gently transition the loading camera to the visitor start point
  walker.setPosition(4.5, 62, 0.05, -0.04);
  scene.fog.density = 0.0007 + (1 - settings.fog / 100) * 0.0055;
  ambience.setVolume(settings.vol / 100);
  renderAtlasPins();
  // pre-compile shaders to avoid first-frame hitch
  renderer.compile(scene, camera);
  loop();
}).catch((err) => {
  console.error(err);
  loaderText.textContent = "تعذّر تحميل المشهد";
  $("fatal").classList.remove("hidden");
});
