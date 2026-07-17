/**
 * One-time A-Frame components for the ambient pillar depth field.
 * Mouse-driven logic from the original demo is replaced by `auto-wave` so motion
 * runs on its own (aligned with the gradient’s “alive” feel).
 */
// @ts-nocheck — A-Frame uses runtime `this` on component defs
import "aframe";

export function registerAFrameDepthComponents(): void {
  const AFRAME = typeof window !== "undefined" ? window.AFRAME : null;
  if (!AFRAME || AFRAME.components["auto-wave"]) return;

  AFRAME.registerComponent("fit-frustum", {
    init: function () {
      window.addEventListener("resize", () => this.fitToCamera());
      this.fitToCamera();
    },
    fitToCamera: function () {
      const el = this.el;
      const sceneEl = el.sceneEl;
      const camera = sceneEl.camera;

      if (!camera) {
        sceneEl.addEventListener("camera-set-active", () => this.fitToCamera());
        return;
      }

      const distance = camera.el.object3D.position.y - el.object3D.position.y;
      const vFov = (camera.fov * Math.PI) / 180;
      const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
      const aspect = window.innerWidth / window.innerHeight;
      const visibleWidth = visibleHeight * aspect;

      el.setAttribute("width", visibleWidth);
      el.setAttribute("height", visibleHeight);
    },
  });

  AFRAME.registerComponent("auto-wave", {
    schema: {
      speed: { default: 0.5 },
      amplitude: { default: 2.2 },
      freq: { default: 0.14 },
    },
    init: function () {
      this.baseY = this.el.object3D.position.y;
      this.phase = Math.random() * Math.PI * 2;
    },
    tick: function (time) {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const THREE = window.AFRAME.THREE;
      const t = time * 0.001 * this.data.speed;
      const x = this.el.object3D.position.x;
      const z = this.el.object3D.position.z;
      const f = this.data.freq;
      const wave =
        Math.sin(t + x * f + this.phase) * Math.cos(t * 0.68 + z * f * 0.85);
      const targetY = this.baseY + wave * this.data.amplitude;
      this.el.object3D.position.y = THREE.MathUtils.lerp(
        this.el.object3D.position.y,
        targetY,
        0.11,
      );
    },
  });

  AFRAME.registerComponent("dynamic-pillar-grid", {
    schema: {
      width: { default: 1.5 },
      depth: { default: 1.5 },
      height: { default: 10 },
      spacing: { default: 0.2 },
    },
    init: function () {
      this.pillars = [];
      window.addEventListener("resize", () => this.updateGrid());
      // Frustum plane may not have width/height until camera is ready — retry a few times
      [100, 400, 900, 2000].forEach((ms) => setTimeout(() => this.updateGrid(), ms));
    },
    updateGrid: function () {
      const frustumPlane = document.querySelector("[fit-frustum]");
      if (!frustumPlane) return;

      const rawW = frustumPlane.getAttribute("width");
      const rawH = frustumPlane.getAttribute("height");
      const vWidth = Number.isFinite(parseFloat(rawW)) ? parseFloat(rawW) : 48;
      const vHeight = Number.isFinite(parseFloat(rawH)) ? parseFloat(rawH) : 27;

      const colWidth = this.data.width + this.data.spacing;
      const rowDepth = this.data.depth + this.data.spacing;

      let cols = Math.floor(vWidth / colWidth) + 2;
      if (cols % 2 === 0) cols++;

      let rows = Math.floor(vHeight / rowDepth) + 2;
      if (rows % 2 === 0) rows++;

      const totalNeeded = cols * rows;

      while (this.pillars.length > totalNeeded) {
        const p = this.pillars.pop();
        if (p?.parentNode) p.parentNode.removeChild(p);
      }

      while (this.pillars.length < totalNeeded) {
        const p = document.createElement("a-box");
        p.setAttribute("width", String(this.data.width));
        p.setAttribute("depth", String(this.data.depth));
        p.setAttribute("height", String(this.data.height));
        p.setAttribute("color", "#3d3d4a");
        p.setAttribute("metalness", "0.45");
        p.setAttribute("roughness", "0.55");
        p.setAttribute("auto-wave", "amplitude: 2.4; speed: 0.52; freq: 0.14");
        this.el.appendChild(p);
        this.pillars.push(p);
      }

      const offsetX = ((cols - 1) * colWidth) / 2;
      const offsetZ = ((rows - 1) * rowDepth) / 2;

      for (let i = 0; i < this.pillars.length; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = c * colWidth - offsetX;
        const z = r * rowDepth - offsetZ;
        this.pillars[i].setAttribute("position", `${x} 0 ${z}`);
      }
    },
  });
}
