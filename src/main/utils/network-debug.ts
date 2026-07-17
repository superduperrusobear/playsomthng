import { logger } from "./logger";

export interface DebugFetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * A reusable network debug wrapper around fetch.
 * Logs exact URLs, methods, headers, and exact failure reasons (DNS, timeout, etc).
 */
export async function debugFetch(url: string | URL, options: DebugFetchOptions = {}): Promise<Response> {
  const method = options.method || "GET";
  const urlStr = typeof url === "string" ? url : url.toString();
  
  logger.info(`[NET_REQ] START: ${method} ${urlStr}`);
  
  if (options.headers) {
    const headersSafe = { ...options.headers } as Record<string, string>;
    if (headersSafe.Authorization) headersSafe.Authorization = "[REDACTED]";
    logger.info(`[NET_REQ] HEADERS: ${JSON.stringify(headersSafe)}`);
  }

  const timeoutMs = options.timeoutMs ?? 30000;
  const controller = new AbortController();
  
  let timeoutId: NodeJS.Timeout | undefined;
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }
  
  // if caller passed their own signal, we should probably combine them, but for now we just use the controller's signal
  // Wait, if options.signal exists, we should use it. Let's merge them:
  let finalSignal = controller.signal;
  if (options.signal) {
    // Basic merge:
    options.signal.addEventListener("abort", () => controller.abort());
    if (options.signal.aborted) controller.abort();
  }

  const fetchOpts: RequestInit = {
    ...options,
    signal: finalSignal,
  };

  try {
    const start = Date.now();
    const res = await fetch(urlStr, fetchOpts);
    const duration = Date.now() - start;
    
    logger.info(`[NET_RES] OK: ${method} ${urlStr} -> ${res.status} ${res.statusText} (${duration}ms)`);
    
    // We can't safely read the body here without consuming the stream, 
    // unless we clone the response. Let's clone for debug logging if status isn't 200.
    if (!res.ok) {
      try {
        const text = await res.clone().text();
        const snippet = text.slice(0, 300);
        logger.warn(`[NET_RES] ERROR BODY: ${snippet}`);
      } catch (err) {
        logger.warn(`[NET_RES] Could not read error body: ${String(err)}`);
      }
    }
    
    return res;
  } catch (error: any) {
    const errCode = error.cause?.code || error.code || error.name || "UNKNOWN_ERROR";
    const errMsg = error.message || String(error);
    
    logger.error(`[NET_ERR] FAILED: ${method} ${urlStr} -> ${errCode}: ${errMsg}`);
    
    // Attempt to categorize
    if (error.name === "AbortError" || errMsg.includes("timeout")) {
      logger.error(`[NET_DIAG] Diagnosis: Timeout after ${timeoutMs}ms.`);
    } else if (errCode === "ERR_NAME_NOT_RESOLVED" || errCode === "ENOTFOUND") {
      logger.error(`[NET_DIAG] Diagnosis: DNS resolution failed. Check internet connection or DNS settings.`);
    } else if (errCode === "ERR_CONNECTION_REFUSED" || errCode === "ECONNREFUSED") {
      logger.error(`[NET_DIAG] Diagnosis: Connection refused. Server is down or blocked by firewall.`);
    } else if (errCode === "ERR_CERT_AUTHORITY_INVALID") {
      logger.error(`[NET_DIAG] Diagnosis: TLS/SSL Certificate error.`);
    }
    
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
