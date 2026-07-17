//! Admin-editable metadata for every catalog/store item.
//!
//! Lifecycle:
//!   1. Package is scanned → manifest is created (manifest.rs).
//!   2. Admin opens the import editor → CatalogMeta is created / loaded.
//!   3. Admin optionally enriches fields from IGDB.
//!   4. Admin saves: `published: false` = draft, `published: true` = live on Store.
//!
//! Files: `{dataDir}/catalog-meta/{id}.json` - one file per catalog slug.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Same namespace as `src/shared/catalog-mapper.ts` - stable UUID from catalog slug.
const CATALOG_NAMESPACE: &str = "e7b8c5d0-9d2a-4f6e-8b1c-0a3d5e7f9a2b";

/// Deterministic UUID string for a catalog slug (matches Electron `catalogSlugToStableUuid`).
pub fn stable_uuid_for_slug(slug: &str) -> Option<String> {
    let ns = Uuid::parse_str(CATALOG_NAMESPACE).ok()?;
    Some(Uuid::new_v5(&ns, slug.as_bytes()).to_string())
}

fn looks_like_uuid_param(s: &str) -> bool {
    Uuid::parse_str(s.trim()).is_ok()
}

/// Load metadata for a **catalog game id** (always the folder slug from `/api/games`).
/// Tries `{slug}.json`, then legacy `{uuid-v5}.json` from older clients that keyed files by UUID.
pub fn load_meta_by_catalog_slug(
    data_dir: &Path,
    catalog_slug: &str,
) -> anyhow::Result<Option<CatalogMeta>> {
    if let Ok(Some(m)) = load_meta(data_dir, catalog_slug) {
        return Ok(Some(m));
    }
    if let Some(uuid) = stable_uuid_for_slug(catalog_slug) {
        if let Ok(Some(m)) = load_meta(data_dir, &uuid) {
            return Ok(Some(m));
        }
    }
    Ok(None)
}

/// Load for admin `GET /catalog-meta/:id` where `id` may be slug **or** UUID (deep links).
pub fn load_meta_for_admin_path(data_dir: &Path, id: &str) -> anyhow::Result<Option<CatalogMeta>> {
    if let Ok(Some(m)) = load_meta(data_dir, id) {
        return Ok(Some(m));
    }
    if looks_like_uuid_param(id) {
        return Ok(None);
    }
    if let Some(uuid) = stable_uuid_for_slug(id) {
        return load_meta(data_dir, &uuid);
    }
    Ok(None)
}

/// Which platform(s) a package targets.  
/// If any non-Windows platform is listed and `emulator_override` is not set,
/// the item is considered emulator-required.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlatformTag {
    Windows,
    Ps1,
    Ps2,
    Ps3,
    Ps4,
    Ps5,
    Xbox,
    Xbox360,
    XboxOne,
    Nes,
    Snes,
    N64,
    GameCube,
    Wii,
    WiiU,
    Switch,
    Gba,
    Nds,
    #[serde(rename = "3ds")]
    ThreeDs,
    Psp,
    PsVita,
    Arcade,
    Other,
}

impl PlatformTag {
    pub fn requires_emulator(&self) -> bool {
        !matches!(self, PlatformTag::Windows)
    }
}

/// Publish state visible to the admin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PublishState {
    /// Saved locally but not visible on the Store.
    #[default]
    Draft,
    /// Live on the Store carousel.
    Published,
}

/// Full admin-editable metadata for one catalog item.
/// This is the source of truth after import; IGDB data is merged in and can be overridden.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMeta {
    /// Stable slug-based id (same as catalog/manifest id).
    pub id: String,
    /// URL-safe slug (same as id for now).
    pub slug: String,
    /// Human-readable display name - admin may rename from the raw folder name.
    pub display_name: String,

    // ── Package info ──────────────────────────────────────────────────────────
    pub package_type: String, // pc-game | rom | rom-bundle | iso | emulator
    pub version: Option<String>,

    // ── Descriptions ──────────────────────────────────────────────────────────
    pub description: Option<String>,
    pub short_description: Option<String>,

    /// Credits (often from IGDB involved companies).
    pub developer: Option<String>,
    pub publisher: Option<String>,
    /// ISO `YYYY-MM-DD` - first release from IGDB or manual.
    pub release_date: Option<String>,

    // ── Platform & emulator ───────────────────────────────────────────────────
    /// Which platforms this title supports.
    pub platform_tags: Vec<PlatformTag>,
    /// Derived: true if any platform_tag requires an emulator.
    /// May be overridden by `emulator_override`.
    pub emulator_required: bool,
    /// When true, `emulator_required` is set by the admin regardless of platform_tags.
    pub emulator_override: bool,

    // ── Launch ────────────────────────────────────────────────────────────────
    /// Relative path inside the package root (from manifest), e.g. `game.exe` or `rom.sfc`.
    pub launch_target: Option<String>,

    // ── Media ─────────────────────────────────────────────────────────────────
    pub cover_image_url: Option<String>,
    pub screenshot_urls: Vec<String>,

    // ── Admin notes ───────────────────────────────────────────────────────────
    /// Shown to users - e.g. "Mount ISO before launching", "Requires RPCS3 firmware".
    pub special_instructions: Option<String>,
    /// Internal admin-only notes (not shown to users).
    pub admin_notes: Option<String>,

    // ── Store state ───────────────────────────────────────────────────────────
    pub publish_state: PublishState,

    // ── IGDB tracking ─────────────────────────────────────────────────────────
    pub igdb_id: Option<u64>,
    pub igdb_slug: Option<String>,

    // ── Timestamps (Unix seconds) ─────────────────────────────────────────────
    pub created_at: i64,
    pub updated_at: i64,
}

impl CatalogMeta {
    /// Build a minimal default meta from the catalog id and display name,
    /// to be enriched by the admin before publishing.
    pub fn new_draft(id: &str, display_name: &str) -> Self {
        let now = unix_now();
        Self {
            id: id.to_string(),
            slug: id.to_string(),
            display_name: display_name.to_string(),
            package_type: "pc-game".to_string(),
            version: None,
            description: None,
            short_description: None,
            developer: None,
            publisher: None,
            release_date: None,
            platform_tags: vec![PlatformTag::Windows],
            emulator_required: false,
            emulator_override: false,
            launch_target: None,
            cover_image_url: None,
            screenshot_urls: vec![],
            special_instructions: None,
            admin_notes: None,
            publish_state: PublishState::Draft,
            igdb_id: None,
            igdb_slug: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Recompute `emulator_required` from `platform_tags` unless `emulator_override` is set.
    /// Call this after any edit to platform_tags.
    pub fn recompute_emulator(&mut self) {
        if !self.emulator_override {
            self.emulator_required = self.platform_tags.iter().any(|p| p.requires_emulator());
        }
    }

    pub fn touch(&mut self) {
        self.updated_at = unix_now();
    }
}

// ── File I/O ──────────────────────────────────────────────────────────────────

fn meta_path(data_dir: &Path, id: &str) -> PathBuf {
    data_dir.join("catalog-meta").join(format!("{id}.json"))
}

/// Read metadata for `id`; returns `None` if not found.
pub fn load_meta(data_dir: &Path, id: &str) -> anyhow::Result<Option<CatalogMeta>> {
    let path = meta_path(data_dir, id);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)?;
    let meta = serde_json::from_str(&raw)?;
    Ok(Some(meta))
}

/// Write metadata; creates the directory if needed.
pub fn save_meta(data_dir: &Path, meta: &CatalogMeta) -> anyhow::Result<()> {
    let dir = data_dir.join("catalog-meta");
    std::fs::create_dir_all(&dir)?;
    let path = meta_path(data_dir, &meta.id);
    std::fs::write(path, serde_json::to_vec_pretty(meta)?)?;
    Ok(())
}

/// List all catalog-meta ids on disk (slugs that have been imported in the editor).
pub fn list_meta_ids(data_dir: &Path) -> anyhow::Result<Vec<String>> {
    let dir = data_dir.join("catalog-meta");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut ids = vec![];
    for entry in std::fs::read_dir(&dir)? {
        let e = entry?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.ends_with(".json") {
            ids.push(name.trim_end_matches(".json").to_string());
        }
    }
    Ok(ids)
}

fn unix_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
