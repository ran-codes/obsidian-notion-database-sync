# ADR: Database Refresh Workflow

**Status:** Decided (revised 2026-02-04)
**Date:** 2026-02-03

## Problem

Two problems with the original import implementation:

1. **Redundant API calls on refresh.** For a 200-row database with only 5 changed rows, the importer was making ~200 `pages.retrieve()` calls and ~200 `blocks.children.list()` calls. The `dataSources.query()` batch call already returns full page objects with `last_edited_time`, so both are avoidable for unchanged rows.

2. **Misleading refresh UX.** The progress UI showed `1/N ... N/N` for all rows even when most were skipped. The skip check happened per-row inside the import callback rather than as a pre-filter, so the user saw progress ticking through rows that required no work.

## Scope Decision: Database-only Plugin

This plugin is purpose-built for Notion **database** syncs. The following are explicitly out of scope and should be removed:

- **Standalone page imports** — no page ID input, no `detectNotionObject` page routing
- **"Re-sync this page" command** — refresh is always database-wide, never single-row
- **Force re-import** — no UI for it, not supported

The modal should only accept database IDs/URLs.

## Change Detection: Per-file `notion-last-edited`

### Options Considered

#### Option 1: Database-level `last_edited_time`
Store a single timestamp per database and skip the entire database if unchanged. Too coarse — a single edit forces re-import of all rows.

#### Option 2: Per-file `notion-last-edited` (chosen)
Store `last_edited_time` from the page object in each file's YAML frontmatter. On refresh, compare the stored timestamp against the batch query result before fetching blocks.

#### Option 3: Content hashing
Hash the markdown output and compare on re-import. Expensive (must still fetch all blocks to compute hash) and doesn't solve the API call problem.

### Choice & Rationale

**Option 2** was chosen because:
- The page `last_edited_time` is already available in the batch query result at zero API cost
- Per-file granularity means only truly changed rows are re-imported
- The pre-fetched page object from `dataSources.query()` eliminates `pages.retrieve()` entirely
- For a 200-row database with 5 changes: API calls drop from ~400 to ~5

## Architecture: Two Orchestration Functions

Fresh imports and refreshes are fundamentally different workflows. They share the same batch query logic and page-level import function, but have separate orchestration.

### `freshDatabaseImport()`

For first-time database syncs.

1. **Discovery:** Check target folder for existing sync (files with matching `notion-database-id` frontmatter). Abort with notice if already synced.
2. **Batch query:** Paginated `dataSources.query()` (100 rows per call) to fetch all page objects.
3. **Import all rows:** Progress UI shows `1/N ... N/N` — every row is imported.
4. **End summary.**

### `refreshDatabase()`

For re-syncing an already-imported database.

1. **Batch query:** Paginated `dataSources.query()` — notice: "Querying database metadata from Notion..."
2. **Local diff pass:** Iterate all returned page objects, read each corresponding local file's `notion-last-edited` frontmatter, compare against `page.last_edited_time`. Build a list of stale rows. Notice: "Checking against current freeze dates..."
3. **Discovery result:** Informational flash: "Detected X files out of date"
4. **Import stale rows only:** Progress UI shows `1/X ... X/X` where X is only the stale count, not total rows.
5. **End summary.**

### Shared Internals (DRY)

Both orchestration functions reuse:
- **Batch query logic** — paginated `dataSources.query()` returning `PageObjectResponse[]`
- **Page-level import function** — fetch blocks, build markdown, write file with frontmatter (`notion-id`, `notion-last-edited`, `notion-database-id`, etc.)
- **Frontmatter read/write helpers**

## Implementation Notes

### Removals
1. **Standalone page import path:** Remove `freezePage()` standalone usage, `detectNotionObject` page routing in `main.ts`, page ID acceptance in `freeze-modal.ts`
2. **"Re-sync this page" command:** Remove `resync-notion` command registration and `executeRefreeze()` in `main.ts`
3. **`pages.retrieve()` fallback:** No longer needed since all imports go through database batch query

### Changes
1. **`database-helpers.ts` or new orchestration module:** Split into `freshDatabaseImport()` and `refreshDatabase()` with the two-pass approach for refresh
2. **`page-freezer.ts`:** Refactor to a shared page-level import function (no standalone orchestration)
3. **`freeze-modal.ts`:** Only accept database IDs/URLs; remove page ID input
4. **`main.ts`:** Remove `resync-notion` command; update `sync-notion` to database-only
5. **Refresh diff pass:** New logic to iterate batch query results, read local frontmatter, and partition into stale vs current before calling the import function
6. **Progress UI:** Refresh progress denominator is stale count, not total row count

### Backwards compatibility
- Files without `notion-last-edited` (from older imports) are treated as stale and re-imported, naturally gaining the field
- Existing synced databases are detected by scanning for `notion-database-id` in frontmatter
