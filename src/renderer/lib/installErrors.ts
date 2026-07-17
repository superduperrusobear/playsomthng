/**
 * Electron wraps IPC failures as long strings like
 * `Error invoking remote method 'install:start': Error: …`.
 * Extract the inner message so the UI shows a short, readable line.
 */
export function humanizeInstallInvokeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let m = err.message;
  const patterns = [
    /^Error invoking remote method '[^']+':\s*Error:\s*(.+)$/i,
    /^Error invoking remote method '[^']+':\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const x = m.match(re);
    if (x?.[1]) {
      m = x[1].trim();
      break;
    }
  }
  return m;
}
