//! Monotonic catalog revision - bumps when admin-facing catalog metadata changes.
//! Clients compare `GET /api/catalog-revision` (or SSE) to avoid refetching `/api/games` when nothing changed.

use std::path::Path;
use std::sync::atomic::Ordering;

use crate::state::AppState;

const FILENAME: &str = "catalog-revision.txt";

pub fn revision_file_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(FILENAME)
}

pub fn load_revision_from_disk(data_dir: &Path) -> u64 {
    let path = revision_file_path(data_dir);
    let Ok(bytes) = std::fs::read(&path) else {
        return 0;
    };
    let s = String::from_utf8_lossy(&bytes);
    s.trim().parse().unwrap_or(0)
}

fn save_revision_to_disk(data_dir: &Path, rev: u64) -> std::io::Result<()> {
    std::fs::write(revision_file_path(data_dir), rev.to_string())
}

/// Increment revision, persist, and notify SSE subscribers.
pub fn bump_catalog_revision(state: &AppState) -> u64 {
    let r = state
        .catalog_revision
        .fetch_add(1, Ordering::SeqCst)
        .saturating_add(1);
    if let Err(e) = save_revision_to_disk(&state.data_dir, r) {
        tracing::warn!(err = %e, "failed to persist catalog revision");
    }
    let _ = state.catalog_revision_tx.send(r);
    r
}
