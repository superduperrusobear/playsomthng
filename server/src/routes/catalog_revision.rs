//! `GET /api/catalog-revision` and `GET /api/catalog/stream` (SSE).

use std::convert::Infallible;
use std::sync::atomic::Ordering;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::Stream;
use serde_json::json;
use async_stream::stream;

use crate::state::AppState;

/// Maximum simultaneous SSE catalog-stream connections. Without a cap an
/// attacker could open thousands of idle long-lived connections and exhaust
/// server resources (the stream is otherwise unauthenticated by design).
const MAX_SSE_CONNECTIONS: u64 = 64;

#[derive(serde::Serialize)]
pub struct CatalogRevisionBody {
    pub revision: u64,
}

pub async fn get_catalog_revision(State(state): State<AppState>) -> Json<CatalogRevisionBody> {
    let revision = state.catalog_revision.load(Ordering::SeqCst);
    Json(CatalogRevisionBody { revision })
}

pub async fn catalog_revision_stream(
    State(state): State<AppState>,
) -> axum::response::Response {
    // Bound concurrent connections; reject extras with 503.
    let prev = state.sse_connections.fetch_add(1, Ordering::SeqCst);
    if prev >= MAX_SSE_CONNECTIONS {
        state.sse_connections.fetch_sub(1, Ordering::SeqCst);
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Too many catalog stream connections — retry shortly.",
        )
            .into_response();
    }

    let rev = state.catalog_revision.load(Ordering::SeqCst);
    let tx = state.catalog_revision_tx.clone();
    let counter = state.sse_connections.clone();

    let s = stream! {
        let payload = json!({ "revision": rev }).to_string();
        yield Ok::<_, Infallible>(Event::default().data(payload));

        let mut rx = tx.subscribe();
        loop {
            match rx.recv().await {
                Ok(r) => {
                    let payload = json!({ "revision": r }).to_string();
                    yield Ok(Event::default().data(payload));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    // When the stream ends (client disconnects or channel closes), decrement.
    let counted = CountedStream::new(s, counter);
    Sse::new(counted).keep_alive(KeepAlive::default()).into_response()
}

/// Wraps a stream so the SSE connection counter is decremented on drop.
struct CountedStream<S> {
    inner: S,
    counter: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl<S> CountedStream<S> {
    fn new(inner: S, counter: std::sync::Arc<std::sync::atomic::AtomicU64>) -> Self {
        Self { inner, counter }
    }
}

impl<S, Item> Stream for CountedStream<S>
where
    S: Stream<Item = Item>,
{
    type Item = Item;

    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        // Safety: we project to `inner` and never move it out of the struct.
        let this = unsafe { self.get_unchecked_mut() };
        // Safety: `inner` is pinned for the duration of this poll since we hold
        // a unique borrow of `this` and do not move it.
        unsafe { std::pin::Pin::new_unchecked(&mut this.inner).poll_next(cx) }
    }
}

impl<S> Drop for CountedStream<S> {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::SeqCst);
    }
}
