# Handoff — launcher metadata, Store, and polish (session wrap-up)

Use this to pick up where we left off. Server is Rust (`server/`); client is Electron + React (`src/`).

---

## 1. Metadata & IGDB (backend)

- **`server/src/catalog_meta.rs`** — Admin-editable `CatalogMeta` (display name, descriptions, platforms, emulator flags, launch target, cover/screenshots URLs, notes, publish state). Files: `{dataDir}/catalog-meta/{slug-or-uuid}.json`.
- **`server/src/igdb.rs`** — Twitch OAuth + IGDB search/fetch. Env: `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, optional `IGDB_APP_NAME`. No secrets in source.
- **`server/src/routes/admin.rs`** — `GET/PUT /api/admin/catalog-meta/:id`, `GET /api/admin/igdb/search`, `GET /api/admin/igdb/game/:igdb_id`.
- **`server/src/catalog.rs`** — After building the catalog list, **`overlay_catalog_meta_from_disk`** merges `catalog-meta` into each `CatalogGame` so `/api/games` returns `coverImage`, `screenshotUrls`, `description`, etc.
- **Slug vs UUID** — Catalog `id` is always the **folder slug**. Metadata may exist as `{slug}.json` or legacy `{uuid-v5(slug)}.json`. **`catalog_meta::load_meta_by_catalog_slug`** and **`load_meta_for_admin_path`** try both so the editor and overlay stay in sync.
- **`server/src/main.rs`** — Loads `.env` from CWD and **`server/.env`** so `npm run server` (repo root) still picks up IGDB keys.

**Server README:** `server/README.md` (config, manifests, how to run).

---

## 2. Electron — import editor & publish

- **`src/renderer/pages/settings/ImportEditorPage.tsx`** — Full metadata editor (IGDB search, fields, launch target, publish/draft). **Publish to Store** must add the game to `store-publish.json` using the **stable catalog UUID** (`storeListGameId` / `catalogSlugToStableUuid`), not `saved.id` from the server (that is the **slug** from the URL path).
- **`src/renderer/pages/settings/AdminPage.tsx`** — Import/Edit routes use **`g.slug`** in the URL (`/settings/admin/import/:slug`).
- **`store-publish.json`** — `gameIds` are **UUIDs** only (Zod). User Library is separate (`user-library.json`).

---

## 3. Shared schemas & IPC

- **`src/shared/schemas/catalog-meta.schema.ts`**, **`igdb.schema.ts`**, **`store-publish.schema.ts`**
- **`src/main/ipc/catalog-meta.handler.ts`**, **`igdb.handler.ts`** — Proxy to Rust admin API using the enabled source `baseUrl`.
- **`src/renderer/hooks/useCatalogMeta.ts`** — On successful save, invalidates **`["library"]`** so the Store refetches.

---

## 4. Catalog → Store / Library (covers & text)

- **`src/shared/catalog-mapper.ts`** — Maps Rust catalog rows to `GameListItem` / `Game`. **`safeHttpUrl`** allows **protocol-relative** URLs (`//images.igdb.com/...`).
- **`src/shared/schemas/game.schema.ts`** — List/game media fields use plain **`z.string()`** for URLs (not strict `.url()`), so IGDB/CDN strings are not dropped at parse time.
- **`src/renderer/lib/storeGame.ts`** — **`resolveStoreCoverImage`** (cover → banner → first screenshot). **`preferHigherResImageUrl`** rewrites IGDB URLs to **`t_1080p`** for sharper art on large cards. **`gameListItemToGame`** applies both.
- **UI:** `HoloStoreCard`, `ExpandedCard`, `GameCard` use **`resolveStoreCoverImage`** / **`preferHigherResImageUrl`** where needed.

---

## 5. Auth (dev mock)

- **`src/main/ipc/auth.handler.ts`** — Username + setup key match is **case-insensitive** (trimmed). Mock users: `admin` / `adminkey`, `USER` / `USERKEY`.

---

## 6. Store UI polish

- **`src/renderer/components/store/storeCarouselLayout.ts`** — `STORE_CARD_WIDTH_PX` / `GAP` (~**1.75×** base card width).
- **`src/renderer/pages/StorePage.tsx`** — Carousel step math + **larger arrow** controls (`h-14` buttons, `h-8` icons).
- **`src/renderer/components/layout/Dock.tsx`** — **Larger dock** hit areas (`h-14`) and **32px** nav icons, slightly wider gap.

---

## 7. Env & running locally

- **IGDB:** Put keys in **`playsomthng/server/.env`** (or repo `.env` if you only use `dotenv()` from CWD). Restart the Rust server after changes.
- **App:** `npm run dev` (or your usual flow). **Library → Sync** refetches `/api/games`; metadata save from the editor also invalidates the library query.

---

## 8. Tomorrow / follow-ups (optional)

- Tighten IGDB image size (`t_original` vs `t_1080p`) if bandwidth or rare 404s appear.
- Harden `store-publish.json` if old slug entries exist (manual edit or small migration).
- Any new platforms: extend `PlatformTag` / `PlatformSchema` in sync.

Good stopping point — see you in a few hours.
