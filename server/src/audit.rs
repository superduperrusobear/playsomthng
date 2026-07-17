//! Append-only audit trail: one JSON line per event in `dataDir/audit.jsonl`.
//! Read it with `tail -f data/audit.jsonl` or `jq`.

use axum::http::HeaderMap;
use serde_json::json;
use std::path::Path;

pub fn log(data_dir: &Path, event: &str, mut fields: serde_json::Value) {
    if let Some(obj) = fields.as_object_mut() {
        obj.insert("ts".into(), json!(chrono::Utc::now().to_rfc3339()));
        obj.insert("event".into(), json!(event));
    }
    let Ok(line) = serde_json::to_string(&fields) else {
        return;
    };
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("audit.jsonl"))
    {
        let _ = writeln!(f, "{line}");
    }
}

/// Newest-first entries, optionally filtered to `events`, capped at `limit`.
pub fn read(
    data_dir: &Path,
    events: Option<&[&str]>,
    limit: usize,
) -> Vec<serde_json::Value> {
    let Ok(raw) = std::fs::read_to_string(data_dir.join("audit.jsonl")) else {
        return vec![];
    };
    let mut out: Vec<serde_json::Value> = raw
        .lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| match events {
            None => true,
            Some(list) => v
                .get("event")
                .and_then(|e| e.as_str())
                .is_some_and(|e| list.contains(&e)),
        })
        .take(limit)
        .collect();
    out.shrink_to_fit();
    out
}

/// Client IP as the reverse proxy reports it (X-Forwarded-For), else "local".
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "local".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn missing_file_reads_empty() {
        assert!(read(dir().path(), None, 10).is_empty());
    }

    #[test]
    fn newest_first_and_limited() {
        let d = dir();
        for i in 0..5 {
            log(d.path(), "download", json!({ "n": i }));
        }
        let out = read(d.path(), None, 2);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["n"], 4);
    }

    #[test]
    fn filters_to_requested_events() {
        let d = dir();
        log(d.path(), "download", json!({}));
        log(d.path(), "user_revoked", json!({ "user": "mike" }));
        log(d.path(), "device_revoked", json!({ "user": "sam" }));

        let revs = read(d.path(), Some(&["user_revoked", "device_revoked"]), 50);
        assert_eq!(revs.len(), 2);
        assert!(revs.iter().all(|e| e["event"] != "download"));
    }

    #[test]
    fn entries_carry_event_and_timestamp() {
        let d = dir();
        log(d.path(), "key_issued", json!({ "user": "mike" }));
        let e = &read(d.path(), None, 1)[0];
        assert_eq!(e["event"], "key_issued");
        assert_eq!(e["user"], "mike");
        assert!(e["ts"].as_str().is_some_and(|s| s.contains('T')));
    }
}
