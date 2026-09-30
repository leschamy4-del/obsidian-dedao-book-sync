/**
 * 同步引擎：拉取（note/list 游标走库）+ 落盘（纯本地写文件）。
 * 拉取与落盘分离：落盘不消耗 API 配额；任何一步被限流/中断都可断点续传。
 */
import { DedaoClient, toRefNote, idLessOrEqual } from './api';
import { computeSeqMap, deriveBooks, mergeRefs, ORPHAN_TOPIC_ID, ORPHAN_BOOK_NAME } from './store';
import { buildFileName, getBookDir, padSeq } from './paths';
import { renderHighlight } from './render';
import type { PluginData, RawNoteItem, RefNote, Settings } from './types';

/** 落盘文件系统接口（Obsidian vault 适配器 / node fs 烟雾脚本各自实现） */
export interface FileStore {
  /** 递归建目录 */
  ensureDir(dir: string): Promise<void>;
  /** 扫描 root 下所有 md，返回 uid → 文件路径 索引 */
  readUidIndex(root: string): Promise<Map<string, string>>;
  /** 读文件（不存在返回 null） */
  readFile(path: string): Promise<string | null>;
  /** 写文件（存在则覆盖） */
  writeFile(path: string, content: string): Promise<void>;
}

export interface FetchStats {
  pagesFetched: number;
  notesSeen: number;
  refsAdded: number;
  refsUpdated: number;
  incrementalDone: boolean;
  backfillDone: boolean;
  stoppedByCutoff: boolean;
}

export interface SyncStats {
  books: number;
  created: number;
  /** 已存在但内容有更新（如补到了想法）而重写的文件数 */
  updated: number;
  skipped: number;
}

/**
 * 一轮拉取：
 *  A) 增量：从最新往回走到 maxSeenId 截止线（新笔记通常 1-3 页）
 *  B) 全量回捞：从 backfillCursor 继续向更旧走 backfillPagesPerRun 页
 */
export async function runFetchCycle(
  data: PluginData,
  client: DedaoClient,
  opts: { backfillPagesPerRun: number; delayMs: number; onPage?: (done: number, total: number | null) => void },
): Promise<FetchStats> {
  // 直接在 data.state 上原地推进游标（调用方持久化 data 即保存进度）
  const state = data.state;
  const stats: FetchStats = {
    pagesFetched: 0,
    notesSeen: 0,
    refsAdded: 0,
    refsUpdated: 0,
    incrementalDone: false,
    backfillDone: state.backfillDone,
    stoppedByCutoff: false,
  };

  const collect = (raws: RawNoteItem[]): RefNote[] => {
    const incoming: RefNote[] = [];
    for (const raw of raws) {
      const ref = toRefNote(raw);
      if (ref) incoming.push(ref);
    }
    return incoming;
  };

  // ---- A) 增量（有 maxSeenId 才有意义）----
  if (state.maxSeenId) {
    const inc = await client.walk({
      startSinceId: '0',
      maxPages: 50,
      delayMs: opts.delayMs,
      stopBelowId: state.maxSeenId,
    });
    stats.pagesFetched += inc.pages;
    stats.notesSeen += inc.notes.length;
    const incoming = collect(inc.notes);
    const merged = mergeRefs(data.refs, incoming);
    data.refs = merged.refs;
    stats.refsAdded += merged.added;
    stats.refsUpdated += merged.updated;
    // 只有把增量窗口真正走完（碰到截止线或走到底）才推进 maxSeenId
    if (inc.stoppedByCutoff || inc.reachedEnd) {
      const newest = inc.notes[0]?.note_id;
      if (newest && !idLessOrEqual(newest, state.maxSeenId)) state.maxSeenId = newest;
      stats.incrementalDone = true;
      stats.stoppedByCutoff = inc.stoppedByCutoff;
    } else {
      // 50 页还没碰到截止线（异常情况），也推进防止死循环
      state.maxSeenId = inc.reachedCursor || state.maxSeenId;
      stats.incrementalDone = true;
    }
  }

  // ---- B) 全量回捞 ----
  if (!state.backfillDone) {
    const start = state.backfillCursor || state.maxSeenId || '0';
    const back = await client.walk({
      startSinceId: start,
      maxPages: Math.max(1, opts.backfillPagesPerRun),
      delayMs: opts.delayMs,
      onPage: ({ page }) => {
        opts.onPage?.(page, null);
      },
    });
    stats.pagesFetched += back.pages;
    stats.notesSeen += back.notes.length;
    const incoming = collect(back.notes);
    const merged = mergeRefs(data.refs, incoming);
    data.refs = merged.refs;
    stats.refsAdded += merged.added;
    stats.refsUpdated += merged.updated;
    state.backfillCursor = back.reachedCursor;
    if (back.reachedEnd) state.backfillDone = true;
    // 回捞途中顺手推进 maxSeenId（第一轮回捞从 0 开始时尤其重要）
    const newest = back.notes[0]?.note_id;
    if (newest && !state.maxSeenId) state.maxSeenId = newest;
    if (state.maxSeenId && newest && !idLessOrEqual(newest, state.maxSeenId)) state.maxSeenId = newest;
  } else {
    stats.backfillDone = true;
  }

  state.lastFetchAt = Date.now();
  stats.backfillDone = state.backfillDone; // 与 state 收口一致（本轮可能刚走到底）
  return stats;
}

/**
 * 落盘：把勾选书籍的划线写成本地 md（纯本地，零 API）。
 * 幂等：uid 已存在则比较渲染结果，内容有变化（如补到了想法）才原地更新，否则跳过。
 */
export async function syncBooks(
  data: PluginData,
  settings: Settings,
  store: FileStore,
  log: (msg: string) => void = () => {},
): Promise<SyncStats> {
  const selected = new Set(settings.selectedTopicIds);
  const byBook = new Map<string, RefNote[]>();
  for (const ref of data.refs) {
    // 无书库归属的划线走 ORPHAN 伪书，出现在书单里可选（默认不选）
    const topicId = ref.bookTopicId || ORPHAN_TOPIC_ID;
    if (!selected.has(topicId)) continue;
    const list = byBook.get(topicId);
    if (list) list.push(ref);
    else byBook.set(topicId, [ref]);
  }

  const root = settings.rootFolder || '00-Inbox/书籍';
  const stats: SyncStats = { books: byBook.size, created: 0, updated: 0, skipped: 0 };
  if (byBook.size === 0) return stats;

  await store.ensureDir(root);
  const uidIndex = await store.readUidIndex(root);
  const seqMap = computeSeqMap(data.refs);

  for (const [topicId, refs] of byBook) {
    const bookName =
      refs[0].bookName || data.books.find(b => b.topicId === topicId)?.name || (topicId === ORPHAN_TOPIC_ID ? ORPHAN_BOOK_NAME : topicId);
    const dir = getBookDir(root, bookName);
    await store.ensureDir(dir);
    for (const ref of refs) {
      const seq = seqMap.get(ref.uid) ?? 1;
      const rendered = renderHighlight(ref, seq, padSeq);
      const existing = uidIndex.get(ref.uid);
      if (existing) {
        // 内容有差异才重写（例如补到了想法字段），否则跳过
        const current = await store.readFile(existing);
        if (current === rendered) {
          stats.skipped += 1;
        } else {
          await store.writeFile(existing, rendered);
          stats.updated += 1;
        }
        continue;
      }
      const fileName = buildFileName(ref.createdAt, seq, ref.text);
      const path = `${dir}/${fileName}`;
      await store.writeFile(path, rendered);
      uidIndex.set(ref.uid, path);
      stats.created += 1;
    }
    log(`《${bookName}》落位完成（累计 ${refs.length} 条）`);
  }
  return stats;
}

/** 拉取 + 推导书单 + 落盘 一整轮 */
export async function runFullCycle(
  data: PluginData,
  settings: Settings,
  client: DedaoClient,
  store: FileStore,
  log: (msg: string) => void = () => {},
  onPage?: (done: number, total: number | null) => void,
): Promise<{ fetch: FetchStats; sync: SyncStats }> {
  const fetchStats = await runFetchCycle(data, client, {
    backfillPagesPerRun: settings.backfillPagesPerRun,
    delayMs: settings.requestDelayMs,
    onPage,
  });
  data.books = deriveBooks(data.refs, data.books);
  const sync = await syncBooks(data, settings, store, log);
  return { fetch: fetchStats, sync };
}
