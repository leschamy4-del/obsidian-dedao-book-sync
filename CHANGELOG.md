# Changelog

## 0.1.0 — 2026-09-29

Initial release.

- Discover books automatically from Dedao Brain note stream (`note/list` carries
  `ref_content` + `topics` for every ebook highlight — no extra scan API needed).
- One folder per book under a configurable root (default `00-Inbox/书籍`),
  one Markdown note per highlight: `YYYY年MM月DD日_NN_summary.md`.
- Margin notes you wrote on a highlight (Dedao app's black text) are synced
  into a `💭 我的想法` section below the original text.
- First-run full backfill in resumable batches (two cursors: incremental
  watermark + backfill cursor), safe against rate limits (throttle + 429
  exponential backoff).
- Idempotent local writes (uid-based dedupe; existing files are updated in
  place only when rendered content changes).
- Orphan highlights without a book topic are grouped under a selectable
  pseudo-book (`未归书划线`), off by default.
- Independent scheduler: 8 interval tiers from 5 minutes to 1 week.