//! Remote: discover folders from HTTP directory index HTML.
//! Local: scan `localGamesRoot` (e.g. `G:\`), one folder per game; write full file manifests under `dataDir/manifests/`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use crate::catalog_meta::{self, CatalogMeta, PlatformTag, PublishState};
use crate::catalog_types::{CatalogGame, CatalogSnapshot};
use crate::config::{AppConfig, CatalogMode};
use crate::manifest::{self, PackageType};
use crate::state::AppState;
use anyhow::Context;
use regex::Regex;
use url::Url;

static HREF_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)href\s*=\s*["']([^"']+)["']"#).expect("href regex"));

const SKIP_EXT: &[&str] = &[
    "rar", "zip", "7z", "tar", "gz", "tgz", "bz2", "xz", "iso", "dmg",
];

pub fn catalog_entry_matches_param(entry: &CatalogGame, param: &str) -> bool {
    if entry.id == param {
        return true;
    }
    catalog_meta::stable_uuid_for_slug(&entry.id).is_some_and(|u| u == param)
}

pub async fn get_catalog(state: &AppState) -> CatalogSnapshot {
    let ttl = Duration::from_secs(state.config.catalog_cache_ttl_seconds.max(5));

    let mut snap = {
        let guard = state.catalog_cache.lock().await;
        if let Some(s) = guard.as_ref() {
            if s.error.is_none() && s.fetched_at.elapsed() < ttl {
                Some(s.clone())
            } else if s.error.is_some() && s.fetched_at.elapsed() < Duration::from_secs(30) {
                Some(s.clone())
            } else {
                None
            }
        } else {
            None
        }
    };

    if snap.is_none() {
        let built = match state.config.catalog_mode {
            CatalogMode::Local => build_catalog_local(state).await,
            CatalogMode::Remote => build_catalog_remote(&state.http, &state.config).await,
        };
        let mut guard = state.catalog_cache.lock().await;
        *guard = Some(built.clone());
        snap = Some(built);
    }

    let mut out = snap.expect("snap");
    // Re-merge on every response so admin/IGDB edits show up without waiting for catalog TTL.
    overlay_catalog_meta_from_disk(&mut out.games, &state.data_dir);
    out
}

/// Merge `catalog-meta` into each catalog row for API clients (Store, library).
/// Catalog `id` is the folder **slug**; metadata may be stored as `{slug}.json` or legacy `{uuid}.json`.
fn overlay_catalog_meta_from_disk(games: &mut [CatalogGame], data_dir: &Path) {
    for g in games.iter_mut() {
        let Ok(Some(meta)) = catalog_meta::load_meta_by_catalog_slug(data_dir, &g.id) else {
            continue;
        };
        apply_catalog_meta_to_game(g, &meta);
    }
}

fn platform_tag_to_api_platform(tag: &PlatformTag) -> &'static str {
    match tag {
        PlatformTag::Windows => "pc",
        PlatformTag::Ps1 => "ps1",
        PlatformTag::Ps2 => "ps2",
        PlatformTag::Ps3 => "ps3",
        PlatformTag::Ps4 => "ps4",
        PlatformTag::Ps5 => "ps5",
        PlatformTag::Xbox => "xbox",
        PlatformTag::Xbox360 => "xbox360",
        PlatformTag::XboxOne => "xboxone",
        PlatformTag::Nes => "nes",
        PlatformTag::Snes => "snes",
        PlatformTag::N64 => "n64",
        PlatformTag::GameCube => "gamecube",
        PlatformTag::Wii => "wii",
        PlatformTag::WiiU => "wiiu",
        PlatformTag::Switch => "switch",
        PlatformTag::Gba => "gba",
        PlatformTag::Nds => "nds",
        PlatformTag::ThreeDs => "3ds",
        PlatformTag::Psp => "psp",
        PlatformTag::PsVita => "psvita",
        PlatformTag::Arcade => "arcade",
        PlatformTag::Other => "other",
    }
}

fn apply_catalog_meta_to_game(g: &mut CatalogGame, meta: &CatalogMeta) {
    if !meta.display_name.trim().is_empty() {
        g.name = meta.display_name.clone();
    }
    g.description = meta.description.clone();
    g.short_description = meta.short_description.clone();
    g.developer = meta.developer.clone();
    g.publisher = meta.publisher.clone();
    g.release_date = meta.release_date.clone();
    g.cover_image = meta.cover_image_url.clone();
    g.screenshot_urls = if meta.screenshot_urls.is_empty() {
        None
    } else {
        Some(meta.screenshot_urls.clone())
    };
    g.platform = meta
        .platform_tags
        .first()
        .map(|t| platform_tag_to_api_platform(t).to_string());
    g.emulator_required = Some(meta.emulator_required);
    g.special_instructions = meta.special_instructions.clone();
    g.publish_state = Some(
        match meta.publish_state {
            PublishState::Published => "published",
            _ => "draft",
        }
        .to_string(),
    );
    g.added_at = Some(meta.created_at);
}

async fn build_catalog_local(state: &AppState) -> CatalogSnapshot {
    let root = match state.config.local_games_root.as_ref() {
        Some(r) if !r.trim().is_empty() => PathBuf::from(r.trim()),
        _ => {
            return CatalogSnapshot {
                fetched_at: Instant::now(),
                games: vec![],
                error: Some("catalogMode is \"local\" but localGamesRoot is missing".into()),
            };
        }
    };

    if !root.is_dir() {
        return CatalogSnapshot {
            fetched_at: Instant::now(),
            games: vec![],
            error: Some(format!(
                "localGamesRoot is not a directory: {}",
                root.display()
            )),
        };
    }

    let data_dir = state.data_dir.clone();
    let config = state.config.clone();
    let res =
        tokio::task::spawn_blocking(move || scan_local_games(&root, &data_dir, &config)).await;

    match res {
        Ok(Ok((games, paths))) => {
            let mut w = state.local_paths.write().await;
            w.clear();
            w.extend(paths);
            CatalogSnapshot {
                fetched_at: Instant::now(),
                games,
                error: None,
            }
        }
        Ok(Err(e)) => CatalogSnapshot {
            fetched_at: Instant::now(),
            games: vec![],
            error: Some(e.to_string()),
        },
        Err(e) => CatalogSnapshot {
            fetched_at: Instant::now(),
            games: vec![],
            error: Some(format!("catalog scan task: {e}")),
        },
    }
}

fn scan_local_games(
    root: &Path,
    data_dir: &Path,
    config: &AppConfig,
) -> anyhow::Result<(Vec<CatalogGame>, HashMap<String, PathBuf>)> {
    let manifest_dir = data_dir.join("manifests");
    std::fs::create_dir_all(&manifest_dir)?;

    let mut folder_names: Vec<String> = Vec::new();
    for entry in std::fs::read_dir(root).with_context(|| format!("read_dir {}", root.display()))? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        if should_skip_file_name(&name) {
            continue;
        }
        folder_names.push(name);
    }
    folder_names.sort_by(|a, b| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()));

    let mut games = Vec::new();
    let mut paths = HashMap::new();
    let mut seen_ids = HashSet::new();

    for raw_name in folder_names {
        let name = clean_display_name(&raw_name);
        let id = slug_id(&name);
        if id.is_empty() || !seen_ids.insert(id.clone()) {
            continue;
        }

        let game_path = root.join(&raw_name);
        let game_path = std::fs::canonicalize(&game_path).unwrap_or(game_path);

        let launch = match manifest::suggest_pc_launch_target(&game_path) {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(path = %game_path.display(), err = %e, "launch target hint failed");
                None
            }
        };

        let manifest_obj =
            match manifest::scan_package(&id, &game_path, PackageType::PcGame, launch) {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!(path = %game_path.display(), err = %e, "manifest scan failed");
                    continue;
                }
            };
        let size = manifest_obj.total_bytes;

        let manifest_path = manifest_dir.join(format!("{}.json", id));
        if let Err(e) = manifest::write_manifest_json(&manifest_obj, &manifest_path) {
            tracing::warn!(path = %manifest_path.display(), err = %e, "manifest write failed");
            continue;
        }

        let download_base_url = config.local_cdn_base(&id);
        let manifest_url = config.manifest_url_for_game_id(&id);

        paths.insert(id.clone(), game_path);

        games.push(CatalogGame {
            id,
            name,
            size: Some(size),
            download_base_url,
            manifest_url,
            cover_image: None,
            screenshot_urls: None,
            description: None,
            short_description: None,
            developer: None,
            publisher: None,
            release_date: None,
            platform: None,
            tags: None,
            emulator_required: None,
            special_instructions: None,
            publish_state: None,
            added_at: None,
        });
    }

    Ok((games, paths))
}

async fn build_catalog_remote(http: &reqwest::Client, config: &AppConfig) -> CatalogSnapshot {
    let base = config.download_base_url.trim_end_matches('/');
    let index_url = format!("{}/", base);

    let html = match http.get(&index_url).send().await {
        Ok(r) => match r.error_for_status() {
            Ok(r) => match r.text().await {
                Ok(t) => t,
                Err(e) => {
                    return CatalogSnapshot {
                        fetched_at: Instant::now(),
                        games: vec![],
                        error: Some(format!("read body: {e}")),
                    };
                }
            },
            Err(e) => {
                return CatalogSnapshot {
                    fetched_at: Instant::now(),
                    games: vec![],
                    error: Some(format!("HTTP: {e}")),
                };
            }
        },
        Err(e) => {
            return CatalogSnapshot {
                fetched_at: Instant::now(),
                games: vec![],
                error: Some(format!("request: {e}")),
            };
        }
    };

    let base_url = match Url::parse(base) {
        Ok(u) => u,
        Err(e) => {
            return CatalogSnapshot {
                fetched_at: Instant::now(),
                games: vec![],
                error: Some(format!("invalid downloadBaseUrl: {e}")),
            };
        }
    };

    let folder_names = match parse_folder_names(&html, &base_url) {
        Ok(v) => v,
        Err(e) => {
            return CatalogSnapshot {
                fetched_at: Instant::now(),
                games: vec![],
                error: Some(e.to_string()),
            };
        }
    };

    let mut games: Vec<CatalogGame> = Vec::with_capacity(folder_names.len());
    let mut seen_ids = HashSet::new();

    for raw_name in folder_names {
        let name = clean_display_name(&raw_name);
        let id = slug_id(&name);
        if id.is_empty() || !seen_ids.insert(id.clone()) {
            if !id.is_empty() {
                tracing::warn!(folder = %raw_name, slug = %id, "skipping duplicate slug");
            }
            continue;
        }

        let download_base_url = join_game_base(&base_url, &raw_name);
        let manifest_url = config.manifest_url_for_game_id(&id);

        games.push(CatalogGame {
            id,
            name,
            size: None,
            download_base_url,
            manifest_url,
            cover_image: None,
            screenshot_urls: None,
            description: None,
            short_description: None,
            developer: None,
            publisher: None,
            release_date: None,
            platform: None,
            tags: None,
            emulator_required: None,
            special_instructions: None,
            publish_state: None,
            added_at: None,
        });
    }

    let mut futs = Vec::new();
    for g in &games {
        let url = g.manifest_url.clone();
        let http = http.clone();
        futs.push(async move { manifest_total_bytes(&http, &url).await });
    }
    let sizes = futures_util::future::join_all(futs).await;
    for (g, sz) in games.iter_mut().zip(sizes.into_iter()) {
        g.size = sz;
    }

    CatalogSnapshot {
        fetched_at: Instant::now(),
        games,
        error: None,
    }
}

fn clean_display_name(raw: &str) -> String {
    let s = raw.trim().trim_matches('\'').trim_matches('"').trim();
    s.to_string()
}

fn slug_id(name: &str) -> String {
    let lower: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in lower.chars() {
        if ch == '-' {
            if !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
            }
        } else {
            out.push(ch);
            prev_dash = false;
        }
    }
    out.trim_matches('-').to_string()
}

fn join_game_base(base: &Url, folder: &str) -> String {
    let folder = folder.trim_end_matches('/');
    let seg = format!("{}/", urlencoding::encode(folder));
    base.join(&seg).map(|u| u.to_string()).unwrap_or_else(|_| {
        format!(
            "{}/{}/",
            base.as_str().trim_end_matches('/'),
            urlencoding::encode(folder)
        )
    })
}

fn parse_folder_names(html: &str, base_url: &Url) -> anyhow::Result<Vec<String>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for cap in HREF_RE.captures_iter(html) {
        let href = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let href = href.trim();
        if href.is_empty()
            || href.starts_with('#')
            || href.to_lowercase().starts_with("javascript:")
        {
            continue;
        }

        let resolved = if href.starts_with("http://") || href.starts_with("https://") {
            Url::parse(href).with_context(|| format!("bad absolute href {href:?}"))?
        } else {
            base_url
                .join(href)
                .with_context(|| format!("join {href:?}"))?
        };

        if resolved.host_str() != base_url.host_str() {
            continue;
        }

        let path = resolved.path();
        let path_no_slash = path.trim_end_matches('/');
        if path_no_slash.is_empty() {
            continue;
        }

        let href_clean = href
            .split('?')
            .next()
            .unwrap_or(href)
            .split('#')
            .next()
            .unwrap_or(href);
        if !href_clean.trim().ends_with('/') {
            continue;
        }

        if let Some(seg) = path_no_slash.rsplit('/').next() {
            if seg.is_empty() || seg == ".." || seg == "." {
                continue;
            }
            if should_skip_file_name(seg) {
                continue;
            }
            let decoded = urlencoding::decode(seg)
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| seg.to_string());
            if seen.insert(decoded.clone()) {
                out.push(decoded);
            }
        }
    }

    out.sort_by(|a, b| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()));
    Ok(out)
}

fn should_skip_file_name(seg: &str) -> bool {
    let lower = seg.to_ascii_lowercase();
    for ext in SKIP_EXT {
        if lower.ends_with(&format!(".{ext}")) {
            return true;
        }
    }
    false
}

async fn manifest_total_bytes(http: &reqwest::Client, url: &str) -> Option<u64> {
    let res = http
        .get(url)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let v: serde_json::Value = res.json().await.ok()?;
    v.get("size")
        .and_then(|x| x.as_u64())
        .or_else(|| v.get("totalBytes").and_then(|x| x.as_u64()))
        .or_else(|| v.get("total_bytes").and_then(|x| x.as_u64()))
        .or_else(|| v.get("bytes").and_then(|x| x.as_u64()))
}
