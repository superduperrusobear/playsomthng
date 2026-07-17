declare module "vanta/dist/vanta.clouds2.min.js" {
  import type * as THREE from "three";

  export default function CLOUDS2(opts: {
    el: HTMLElement;
    THREE: typeof THREE;
    [key: string]: unknown;
  }): { destroy: () => void };
}
