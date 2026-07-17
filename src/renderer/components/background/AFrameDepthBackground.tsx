import { useEffect, useRef } from "react";
import { registerAFrameDepthComponents } from "./aframeDepthFieldRegister";

/**
 * Embedded A-Frame pillar grid (`auto-wave`, no mouse).
 * Layered **above** Vanta; motion is disabled in `auto-wave` when `prefers-reduced-motion`
 * is set — the scene still mounts so the pillars stay visible.
 */
export function AFrameDepthBackground() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = rootRef.current;
    if (!host) return;

    registerAFrameDepthComponents();

    host.innerHTML = `
      <a-scene embedded style="width:100%;height:100%" xr-mode-ui="enabled: false" renderer="colorManagement: true">
        <a-camera look-controls-enabled="false" wasd-controls-enabled="false" position="0 10 0" rotation="-90 0 0"></a-camera>
        <a-plane class="receive-ray" position="0 5 0" rotation="-90 0 0" width="38.4" height="21.6" opacity="0" color="#000000" fit-frustum></a-plane>
        <a-entity dynamic-pillar-grid="width: 1.8; depth: 1.8; height: 8; spacing: 0.35"></a-entity>
        <a-light position="0 11 0" type="point" intensity="2.1"></a-light>
        <a-sky color="#000000"></a-sky>
      </a-scene>
    `;

    return () => {
      host.innerHTML = "";
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-[1] h-full w-full opacity-[0.38] pointer-events-none"
      aria-hidden
    />
  );
}
