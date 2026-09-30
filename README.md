# Dedao Book Sync

> Sync **Dedao (得到) ebook highlights** and **your own margin notes** from 得到大脑 (Dedao Brain) into per-book Markdown folders in Obsidian.

[中文说明见下方](#中文说明)

## What it does

```
00-Inbox/书籍/
  纳瓦尔宝典：财富与幸福指南/
    2026年08月11日_01_财富是你睡觉时仍能赚钱的资产.md
    2026年08月11日_02_寻求财富而非金钱或地位.md
  人生设计课：如何设计充实且快乐的人生/
    ...
```

- **One folder per book, one note per highlight.** File name = date + same-day
  sequence + excerpt. Frontmatter carries a stable `uid` (idempotency key),
  book name, tags including `#书籍/<book>`.
- **Margin notes included.** If you wrote a note on a highlight in the Dedao
  app (the black text below the gray original), it is synced into a
  `💭 我的想法` section under the original text.
- **Automatic book discovery.** The Dedao Brain note stream (`note/list`)
  carries both the highlight body (`ref_content`) and its book topic, so
  walking the stream discovers every book that has at least one highlight —
  including brand-new books that list APIs miss.
- **First-run full backfill, resumable.** History is fetched in batches (two
  cursors: an incremental watermark and a backfill cursor). Interrupted or
  rate-limited runs resume where they stopped.
- **Local writes are free.** Highlights are stored in the plugin's local data
  store; writing/updating Markdown costs zero API calls. Existing files are
  rewritten only when rendered content actually changes.
- **Rate-limit friendly.** Requests are throttled (default 1.2 s) and HTTP 429
  responses back off exponentially (3 s base, max 5 retries).
- **Independent scheduler.** 8 interval tiers (5 min → 1 week), independent
  from any other sync plugin you may use.

## Requirements

A Dedao Brain API credential pair (`apiToken` + `clientId`) from the official
Dedao OpenAPI. The plugin is a client of `openapi.biji.com` only.

## Install

- **Community plugins** (after review): search "Dedao Book Sync".
- **BRAT**: add `leschamy4-del/obsidian-dedao-book-sync`.
- **Manual**: download `main.js`, `manifest.json`, `styles.css` from the
  latest GitHub release into `<vault>/.obsidian/plugins/dedao-book-sync/`.

## Privacy & data handling

- The plugin talks to exactly one host: `https://openapi.biji.com` (official
  Dedao Brain OpenAPI), using the credentials **you** enter in settings.
- Credentials and synced highlights are stored **locally** in
  `<vault>/.obsidian/plugins/dedao-book-sync/data.json`. Nothing is sent
  anywhere else. No telemetry, no analytics.
- Markdown notes are written only inside your vault, under the folder you
  configure (default `00-Inbox/书籍`).

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # build test bundle + node --test
npm run build       # main.js (+ pure-logic modules for tests)
npm run build -- --prod
```

## License

[MIT](LICENSE)

---

# 中文说明

把**得到大脑**里来自得到电子书的**划线**，以及你在划线上写的**想法**，同步成 Obsidian 笔记：一本书一个文件夹、一条划线一个 md。

## 功能

- 文件名 = `日期_同日序号_摘要`；frontmatter 带 `uid` 幂等主键与 `#书籍/<书名>` 标签
- 想法同步：你在得到 App 里写在划线上的黑色文字，进入笔记的 `💭 我的想法` 区块（原文灰色部分即划线正文）
- 书籍自动发现：note/list 全量流水线自带 `ref_content` 与书库归属，走一遍即发现所有有划线的书
- 首次全量回捞：双游标（增量水位 + 回捞游标）分批推进，断点续传；限流保护（1.2s 节流 + 429 指数退避）
- 本地落盘零 API：划线先入本地仓库，写文件不耗配额；已有文件只在内容变化时原地更新
- 独立定时器：8 档间隔（5 分钟 ～ 1 周），与其他同步插件互不影响

## 使用

1. 安装并启用插件
2. 设置里填入得到大脑 OpenAPI 的 `apiToken` / `clientId`
3. 点「立即拉取并同步」，重复几次直到回捞完成（设置页有进度提示）
4. 在书单里勾选要同步的书（未归书划线默认不勾选）

## 隐私与数据

- 仅访问官方开放 API：`https://openapi.biji.com`，凭据由你在设置中填写
- 凭据与划线数据只存在本地 `data.json`，无遥测、无任何第三方上传
- 笔记只写入你配置的 Vault 目录内