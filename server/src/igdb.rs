//! IGDB API client for game metadata enrichment.
//!
//! Credentials come from environment variables only - never hardcoded:
//!   IGDB_CLIENT_ID      - Twitch application client id
//!   IGDB_CLIENT_SECRET  - Twitch application client secret
//!   IGDB_APP_NAME       - optional header / user-agent label
//!
//! Flow:
//!   1. Request a Twitch OAuth token (client_credentials grant).
//!   2. Cache the token + expiry in `IgdbTokenCache`.
//!   3. Use the token to call IGDB v4 endpoints.
//!
//! All fields from IGDB are optional in our model - the admin always has the
//! final say over what gets stored in CatalogMeta.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// ── Token management ──────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct IgdbClient {
    pub client_id: String,
    client_secret: String,
    http: reqwest::Client,
    token_cache: Arc<Mutex<Option<CachedToken>>>,
}

struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

impl IgdbClient {
    /// Build from environment variables.  Returns `None` if credentials are not set.
    pub fn from_env(http: reqwest::Client) -> Option<Self> {
        let client_id = std::env::var("IGDB_CLIENT_ID").ok()?;
        let client_secret = std::env::var("IGDB_CLIENT_SECRET").ok()?;
        Some(Self {
            client_id,
            client_secret,
            http,
            token_cache: Arc::new(Mutex::new(None)),
        })
    }

    /// Returns a valid access token, refreshing via Twitch OAuth if necessary.
    async fn token(&self) -> anyhow::Result<String> {
        let mut guard = self.token_cache.lock().await;

        // 60-second margin to avoid edge expiry
        if let Some(cached) = guard.as_ref() {
            if cached.expires_at > Instant::now() + Duration::from_secs(60) {
                return Ok(cached.access_token.clone());
            }
        }

        tracing::info!(client_id = %self.client_id, "Refreshing Twitch/IGDB token");

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: u64,
        }

        let resp: TokenResponse = self
            .http
            .post("https://id.twitch.tv/oauth2/token")
            .query(&[
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
                ("grant_type", "client_credentials"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        *guard = Some(CachedToken {
            access_token: resp.access_token.clone(),
            expires_at: Instant::now() + Duration::from_secs(resp.expires_in),
        });

        Ok(resp.access_token)
    }

    /// POST to an IGDB v4 endpoint with the given APical body.
    async fn apical_post(&self, endpoint: &str, body: &str) -> anyhow::Result<String> {
        let token = self.token().await?;
        let url = format!("https://api.igdb.com/v4/{endpoint}");
        let app_name = std::env::var("IGDB_APP_NAME").unwrap_or_else(|_| "playsomthng".into());

        let resp = self
            .http
            .post(&url)
            .header("Client-ID", &self.client_id)
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", &app_name)
            .body(body.to_string())
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        Ok(resp)
    }
}

// ── Raw IGDB response types ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct IgdbRawGame {
    pub id: u64,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub summary: Option<String>,
    pub first_release_date: Option<i64>,
    pub total_rating: Option<f64>,
    pub cover: Option<IgdbImage>,
    pub screenshots: Option<Vec<IgdbImage>>,
    pub artworks: Option<Vec<IgdbImage>>,
    pub genres: Option<Vec<IgdbGenre>>,
    pub platforms: Option<Vec<IgdbPlatform>>,
    pub franchises: Option<Vec<IgdbName>>,
    pub collections: Option<Vec<IgdbName>>,
    pub involved_companies: Option<Vec<IgdbInvolvedCompany>>,
}

#[derive(Debug, Deserialize)]
pub struct IgdbImage {
    pub id: u64,
    pub image_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IgdbGenre {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IgdbPlatform {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IgdbName {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IgdbCompany {
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct IgdbInvolvedCompany {
    pub developer: Option<bool>,
    pub publisher: Option<bool>,
    pub company: Option<IgdbCompany>,
}

// ── Public result structs (returned to the rest of the app) ──────────────────

/// Compact search result shown in the import editor's candidate list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgdbSearchResult {
    pub igdb_id: u64,
    pub name: String,
    pub slug: Option<String>,
    pub cover_url: Option<String>,
    pub release_year: Option<i32>,
    pub summary: Option<String>,
    pub platforms: Vec<String>,
    pub genres: Vec<String>,
}

/// Full mapped metadata ready to merge into CatalogMeta.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgdbMeta {
    pub igdb_id: u64,
    pub igdb_slug: Option<String>,
    pub name: String,
    pub summary: Option<String>,
    pub cover_url: Option<String>,
    pub screenshot_urls: Vec<String>,
    pub artwork_urls: Vec<String>,
    pub genres: Vec<String>,
    pub platforms: Vec<String>,
    pub release_date_unix: Option<i64>,
    /// First release as `YYYY-MM-DD` (from `first_release_date`).
    pub release_date_iso: Option<String>,
    pub rating: Option<f64>,
    pub franchises: Vec<String>,
    /// Companies flagged as developers in IGDB.
    pub developers: Vec<String>,
    /// Companies flagged as publishers in IGDB.
    pub publishers: Vec<String>,
}

// ── IGDB image URL helpers ────────────────────────────────────────────────────

fn image_url(image_id: &str, size: &str) -> String {
    format!("https://images.igdb.com/igdb/image/upload/t_{size}/{image_id}.jpg")
}

fn cover_url_from_image(img: &IgdbImage) -> Option<String> {
    img.image_id.as_deref().map(|id| image_url(id, "cover_big"))
}

fn screenshot_url_from_image(img: &IgdbImage) -> Option<String> {
    img.image_id
        .as_deref()
        .map(|id| image_url(id, "screenshot_big"))
}

fn release_year(unix: Option<i64>) -> Option<i32> {
    unix.map(|ts| {
        // ts is seconds since epoch; approximate year
        (ts / 31_557_600 + 1970) as i32
    })
}

fn unix_to_date_iso(ts: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.format("%Y-%m-%d").to_string())
}

fn developers_and_publishers(involved: &[IgdbInvolvedCompany]) -> (Vec<String>, Vec<String>) {
    let mut devs = Vec::new();
    let mut pubs = Vec::new();
    for ic in involved {
        let Some(name) = ic.company.as_ref().and_then(|c| c.name.as_ref()) else {
            continue;
        };
        if ic.developer == Some(true) {
            devs.push(name.clone());
        }
        if ic.publisher == Some(true) {
            pubs.push(name.clone());
        }
    }
    (devs, pubs)
}

// ── Public API ────────────────────────────────────────────────────────────────

impl IgdbClient {
    /// Search IGDB for games matching `query` (fuzzy title search).
    /// Returns up to `limit` compact results.
    pub async fn search(&self, query: &str, limit: u8) -> anyhow::Result<Vec<IgdbSearchResult>> {
        let limit = limit.min(20);
        let body = format!(
            r#"search "{query}"; fields id,name,slug,summary,first_release_date,total_rating,cover.image_id,genres.name,platforms.name; limit {limit};"#,
            query = query.replace('"', r#"\""#),
            limit = limit
        );

        let raw = self.apical_post("games", &body).await?;
        let games: Vec<IgdbRawGame> = serde_json::from_str(&raw)?;

        Ok(games
            .into_iter()
            .map(|g| IgdbSearchResult {
                igdb_id: g.id,
                name: g.name.unwrap_or_default(),
                slug: g.slug,
                cover_url: g.cover.as_ref().and_then(cover_url_from_image),
                release_year: release_year(g.first_release_date),
                summary: g.summary,
                platforms: g
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|p| p.name)
                    .collect(),
                genres: g
                    .genres
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|g| g.name)
                    .collect(),
            })
            .collect())
    }

    /// Fetch full metadata for a single IGDB game id.
    pub async fn fetch_game(&self, igdb_id: u64) -> anyhow::Result<IgdbMeta> {
        let body = format!(
            r#"where id = {igdb_id}; fields id,name,slug,summary,first_release_date,total_rating,cover.image_id,screenshots.image_id,artworks.image_id,genres.name,platforms.name,franchises.name,collections.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher; limit 1;"#
        );

        let raw = self.apical_post("games", &body).await?;
        let mut games: Vec<IgdbRawGame> = serde_json::from_str(&raw)?;

        let g = games
            .pop()
            .ok_or_else(|| anyhow::anyhow!("IGDB game {igdb_id} not found"))?;

        let involved = g.involved_companies.unwrap_or_default();
        let (developers, publishers) = developers_and_publishers(&involved);
        let release_date_iso = g.first_release_date.and_then(|ts| unix_to_date_iso(ts));

        Ok(IgdbMeta {
            igdb_id: g.id,
            igdb_slug: g.slug,
            name: g.name.unwrap_or_default(),
            summary: g.summary,
            cover_url: g.cover.as_ref().and_then(cover_url_from_image),
            screenshot_urls: g
                .screenshots
                .unwrap_or_default()
                .iter()
                .filter_map(screenshot_url_from_image)
                .collect(),
            artwork_urls: g
                .artworks
                .unwrap_or_default()
                .iter()
                .filter_map(screenshot_url_from_image)
                .collect(),
            genres: g
                .genres
                .unwrap_or_default()
                .into_iter()
                .filter_map(|x| x.name)
                .collect(),
            platforms: g
                .platforms
                .unwrap_or_default()
                .into_iter()
                .filter_map(|x| x.name)
                .collect(),
            release_date_unix: g.first_release_date,
            release_date_iso,
            rating: g.total_rating,
            franchises: g
                .franchises
                .unwrap_or_default()
                .into_iter()
                .chain(g.collections.unwrap_or_default())
                .filter_map(|x| x.name)
                .collect(),
            developers,
            publishers,
        })
    }
}
