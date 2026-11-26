import * as THREE from "three";
import { heightAt, slopeAt } from "../world/terrain.js";

const EYE = 1.66;
const WALK = 3.1;
const RUN = 6.4;

/**
 * First-person walker: pointer-lock look, WASD movement, terrain following,
 * slope blocking, and simple vegetation collision pushed in via `addCollider`.
 */
export class Walker {
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = false;
    this.sensitivity = 1.0;
    this.position = new THREE.Vector3(4, 0, 62);
    this.yaw = Math.PI * 0.02;
    this.pitch = -0.06;
    this.velocity = new THREE.Vector3();
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.speed = 0;
    this.colliders = [];
    this.radius = 0.38;
    this.keys = new Set();
    this.onLockChange = opts.onLockChange || (() => {});
    this.onStep = opts.onStep || (() => {});
    this.bounds = opts.bounds || { x0: -120, x1: 120, z0: -120, z1: 96 };
    this.touch = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, moving: false };
    this._euler = new THREE.Euler(0, 0, 0, "YXZ");
    this._stepPhase = 0;
    this._bind();
  }

  setPosition(x, z, yaw, pitch) {
    this.position.set(x, heightAt(x, z), z);
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = pitch;
    this.velocity.set(0, 0, 0);
    this._apply();
  }

  addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " "].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", this._onKeyDown, { passive: false });
    window.addEventListener("keyup", this._onKeyUp);

    this._onMouseMove = (e) => {
      if (!this.enabled || !this.locked) return;
      const s = 0.0022 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    };
    this._onPointerDown = () => {
      if (this.enabled && !this.locked && !this.noLock) this.lock();
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange(this.locked);
    };

    this.dom.addEventListener("mousemove", this._onMouseMove);
    this.dom.addEventListener("pointerdown", this._onPointerDown);
    document.addEventListener("pointerlockchange", this._onLockChange);

    // touch look (right half)
    this._touchState = { lookId: null, lastX: 0, lastY: 0 };
    this.dom.addEventListener(
      "touchstart",
      (e) => {
        if (!this.enabled) return;
        for (const t of e.changedTouches) {
          if (this._touchState.lookId === null && t.clientX > window.innerWidth * 0.42) {
            this._touchState.lookId = t.identifier;
            this._touchState.lastX = t.clientX;
            this._touchState.lastY = t.clientY;
          }
        }
      },
      { passive: true }
    );
    this.dom.addEventListener(
      "touchmove",
      (e) => {
        if (!this.enabled) return;
        for (const t of e.changedTouches) {
          if (t.identifier === this._touchState.lookId) {
            const dx = t.clientX - this._touchState.lastX;
            const dy = t.clientY - this._touchState.lastY;
            this._touchState.lastX = t.clientX;
            this._touchState.lastY = t.clientY;
            this.yaw -= dx * 0.0042 * this.sensitivity;
            this.pitch -= dy * 0.0042 * this.sensitivity;
            this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
          }
        }
      },
      { passive: true }
    );
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._touchState.lookId) this._touchState.lookId = null;
      }
    };
    this.dom.addEventListener("touchend", endTouch, { passive: true });
    this.dom.addEventListener("touchcancel", endTouch, { passive: true });
  }

  lock() {
    if (!this.dom.requestPointerLock) return;
    const p = this.dom.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.dom.requestPointerLock());
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setTouchMove(x, y) {
    this.touch.moveX = x;
    this.touch.moveY = y;
    this.touch.moving = Math.hypot(x, y) > 0.08;
  }

  update(dt) {
    if (!this.enabled) {
      this._apply();
      return;
    }
    const k = this.keys;
    let fx = 0;
    let fz = 0;
    if (k.has("w") || k.has("arrowup")) fz -= 1;
    if (k.has("s") || k.has("arrowdown")) fz += 1;
    if (k.has("a") || k.has("arrowleft")) fx -= 1;
    if (k.has("d") || k.has("arrowright")) fx += 1;
    if (this.touch.moving) {
      fx += this.touch.moveX;
      fz += this.touch.moveY;
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }

    const running = k.has("shift");
    const moveSpeed = running ? RUN : WALK;
    // basis: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const wx = fx * cy + fz * sy;
    const wz = -fx * sy + fz * cy;

    const desiredX = wx * moveSpeed;
    const desiredZ = wz * moveSpeed;
    const accel = 1 - Math.pow(0.0016, dt);
    this.velocity.x += (desiredX - this.velocity.x) * accel;
    this.velocity.z += (desiredZ - this.velocity.z) * accel;

    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;

    // keep inside the playable basin
    nx = Math.max(this.bounds.x0, Math.min(this.bounds.x1, nx));
    nz = Math.max(this.bounds.z0, Math.min(this.bounds.z1, nz));

    // block impossible slopes
    const slope = slopeAt(nx, nz, 0.9);
    if (slope > 0.92) {
      const sx = slopeAt(this.position.x, nz, 0.9);
      const sz = slopeAt(nx, this.position.z, 0.9);
      if (sx <= 0.92) { nx = this.position.x; }
      else if (sz <= 0.92) { nz = this.position.z; }
      else { nx = this.position.x; nz = this.position.z; }
    }

    // vegetation collision
    for (const c of this.colliders) {
      const dx = nx - c.x;
      const dz = nz - c.z;
      const rr = c.r + this.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = c.x + (dx / d) * rr;
        nz = c.z + (dz / d) * rr;
      }
    }

    this.position.x = nx;
    this.position.z = nz;
    const gy = heightAt(nx, nz);
    this.position.y += (gy - this.position.y) * Math.min(1, dt * 12);

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = speed;
    if (speed > 0.35) {
      this.bobPhase += dt * (running ? 11.5 : 7.6);
      this.bobAmount += (Math.min(1, speed / RUN) * 0.055 - this.bobAmount) * Math.min(1, dt * 6);
      this._stepPhase += dt * (running ? 2.5 : 1.75);
      if (this._stepPhase >= 1) {
        this._stepPhase -= 1;
        this.onStep(running);
      }
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, dt * 5);
    }

    this._apply();
  }

  _apply() {
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * this.bobAmount * 0.5;
    this._euler.set(this.pitch + Math.sin(this.bobPhase) * this.bobAmount * 0.05, this.yaw, Math.sin(this.bobPhase * 0.5) * this.bobAmount * 0.06);
    this.camera.quaternion.setFromEuler(this._euler);
    this.camera.position.set(
      this.position.x + Math.cos(this.yaw) * bobX,
      this.position.y + EYE + bobY,
      this.position.z - Math.sin(this.yaw) * bobX
    );
  }
}
