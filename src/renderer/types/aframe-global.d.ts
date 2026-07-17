export {};

declare global {
  interface Window {
    /** A-Frame runtime (set by `import "aframe"`) */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AFRAME: any;
  }
}

declare module "aframe";
