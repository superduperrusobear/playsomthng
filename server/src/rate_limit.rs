//! Lightweight in-process rate limiting for abuse-prone routes (auth + admin).
//!
//! Per-client-IP token bucket: allows `capacity` requests per refill window,
//! refilling continuously. State lives in memory and resets on restart, which
//! is fine for a single-instance self-hosted server. This is a defense against
//! brute-force / enumeration, not a hard DoS guarantee (use an edge rate
//! limiter for that).

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::extract::Request;
use tokio::sync::Mutex;

use crate::state::AppState;

/// One bucket per client IP. `tokens` is a fractional count that refills over time.
struct Bucket {
    tokens: f64,
    last: Instant,
}

#[derive(Clone)]
pub struct RateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Arc<Mutex<HashMap<IpAddr, Bucket>>>,
}

impl RateLimiter {
    pub fn new(capacity: u32, refill_per_sec: f64) -> Self {
        Self {
            capacity: capacity as f64,
            refill_per_sec,
            buckets: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns true if the request is allowed (and consumes a token), false if over limit.
    async fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().await;
        // Periodically prune stale buckets so a rotating attacker doesn't grow the map forever.
        if buckets.len() > 4096 {
            buckets.retain(|_, b| now.duration_since(b.last).as_secs() < 600);
        }
        let entry = buckets.entry(ip).or_insert(Bucket {
            tokens: self.capacity,
            last: now,
        });
        let elapsed = now.duration_since(entry.last).as_secs_f64();
        entry.tokens = (entry.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        entry.last = now;
        if entry.tokens >= 1.0 {
            entry.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Axum middleware: rate-limit by client IP. 429 when over the limit.
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    let limiter = state.auth_rate_limiter.clone();
    let ip = crate::audit::client_ip_addr(&headers);
    if limiter.check(ip).await {
        next.run(request).await
    } else {
        Response::builder()
            .status(StatusCode::TOO_MANY_REQUESTS)
            .header("Retry-After", "5")
            .body(axum::body::Body::from(
                serde_json::json!({ "error": "RATE_LIMITED", "message": "Too many requests — slow down." }).to_string(),
            ))
            .unwrap()
    }
}
