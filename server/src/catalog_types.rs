use std::time::Instant;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CatalogGame {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(rename = "downloadBaseUrl")]
    pub download_base_url: String,
    #[serde(rename = "manifestUrl")]
    pub manifest_url: String,

    // Optional - merged from `catalog-meta/{id}.json` when present (admin / IGDB editor).
    #[serde(rename = "coverImage", skip_serializing_if = "Option::is_none")]
    pub cover_image: Option<String>,
    #[serde(rename = "screenshotUrls", skip_serializing_if = "Option::is_none")]
    pub screenshot_urls: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "shortDescription", skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub developer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(rename = "releaseDate", skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    /// Frontend `Platform` enum value (`pc`, `ps3`, ...).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(rename = "emulatorRequired", skip_serializing_if = "Option::is_none")]
    pub emulator_required: Option<bool>,
    #[serde(
        rename = "specialInstructions",
        skip_serializing_if = "Option::is_none"
    )]
    pub special_instructions: Option<String>,
    /// `published` | `draft` — set from catalog-meta. Only sent on the admin route.
    #[serde(rename = "publishState", skip_serializing_if = "Option::is_none")]
    pub publish_state: Option<String>,
}

#[derive(Clone)]
pub struct CatalogSnapshot {
    pub fetched_at: Instant,
    pub games: Vec<CatalogGame>,
    pub error: Option<String>,
}
