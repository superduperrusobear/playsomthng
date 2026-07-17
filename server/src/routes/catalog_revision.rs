//! `GET /api/catalog-revision` and `GET /api/catalog/stream` (SSE).

use std::convert::Infallible;

use axum::Json;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::Stream;
use serde_json::json;
use std::sync::atomic::Ordering;

use async_stream::stream;

use crate::state::AppState;

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
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rev = state.catalog_revision.load(Ordering::SeqCst);
    let tx = state.catalog_revision_tx.clone();

    let s = stream! {
        let payload = json!({ "revision": rev }).to_string();
        yield Ok(Event::default().data(payload));

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

    Sse::new(s).keep_alive(KeepAlive::default())
}
