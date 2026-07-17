import { useEffect, useRef } from "react";
import * as THREE from "three";
import CLOUDS2 from "vanta/dist/vanta.clouds2.min.js";

/** Procedural noise PNG for CLOUDS2 shader (same role as gallery/noise.png). */
function makeNoiseDataUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Subtle Vanta CLOUDS2 layer — sits under `app-bg-gradient`.
 * Colors match the dark charcoal / grey app canvas; kept low-contrast so UI stays primary.
 */
export function VantaCloudsBackground() {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const texturePath = makeNoiseDataUrl();
    const effect = CLOUDS2({
      el,
      THREE,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      scale: 1,
      // Tuned to our #030303 / grey sweep — not the default silver demo
      backgroundColor: 0x030303,
      skyColor: 0x08080c,
      cloudColor: 0x141820,
      lightColor: 0x4a5058,
      speed: 0.32,
      texturePath,
    });
    return () => {
      effect.destroy();
    };
  }, []);

  return (
    <div
      ref={elRef}
      className="absolute inset-0 opacity-[0.38]"
      aria-hidden
    />
  );
}
