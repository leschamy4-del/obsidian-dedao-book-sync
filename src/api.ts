/**
 * 得到大脑 OpenAPI 客户端（openapi.biji.com）。
 * 2026-09 实测要点：
 *  - note/list 是包含 ref 划线的全量流水线（20 条/页，since_id 游标向更旧方向翻页），
 *    每条 ref 自带 ref_content（正文）与 topics[]（书库归属）→ 无需逐条 note/detail。
 *  - 限流：qps_global_exceeded（HTTP 429，retryable），需节流 + 指数退避。
 */
import type { RawNoteItem, RefNote } from './types';

const BASE = 'https://openapi.biji.com/open/api/v1';
const PAGE_SIZE = 20;

export interface ListNotesResult {
  notes: RawNoteItem[];
  hasMore: boolean;
  nextCursor: string;
}

export interface WalkOptions {
  /** 起始游标（"0" = 从最新开始） */
  startSinceId: string;
  /** 本轮最多翻多少页（防限流分批） */
  maxPages: number;
  /** 每页之间等待毫秒 */
  delayMs: number;
  /** 增量截止线：当某页最小 note_id <= stopBelowId（BigInt 语义）时停止翻页 */
  stopBelowId?: string;
  /** 每页回调（用于进度展示与中断） */
  onPage?: (info: { page: number; notes: RawNoteItem[]; hasMore: boolean }) => void | boolean;
}

export interface WalkResult {
  pages: number;
  notes: RawNoteItem[];
  /** 本轮走到的最旧 note_id（作为下一次 backfill 游标） */
  reachedCursor: string;
  /** 是否已走到底（has_more=false） */
  reachedEnd: boolean;
  stoppedByCutoff: boolean;
}

export class DedaoApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class DedaoClient {
  private lastRequestAt = 0;

  constructor(
    private readonly token: string,
    private readonly clientId: string,
    private readonly opts: { delayMs?: number; fetchImpl?: typeof fetch; maxRetries?: number } = {},
  ) {
    if (!token) throw new DedaoApiError('缺少 apiToken，请先在设置里填写', 0, false);
  }

  private async throttledFetch(url: string): Promise<Response> {
    const f = this.opts.fetchImpl ?? fetch;
    const delay = this.opts.delayMs ?? 1200;
    const wait = this.lastRequestAt + delay - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
    return f(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'X-Client-ID': this.clientId,
      },
    });
  }

  /** GET + 429/网络错误指数退避（3s 起，最多 maxRetries 次） */
  private async getJson(path: string): Promise<Record<string, unknown>> {
    const maxRetries = this.opts.maxRetries ?? 5;
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.throttledFetch(`${BASE}${path}`);
      } catch (err) {
        if (attempt >= maxRetries) throw new DedaoApiError(`网络错误：${String(err)}`, 0, false);
        attempt += 1;
        await sleep(3000 * 2 ** (attempt - 1));
        continue;
      }
      if (res.status === 429) {
        if (attempt >= maxRetries) {
          throw new DedaoApiError('请求频率超限（429），稍后再试', 429, true);
        }
        attempt += 1;
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * 2 ** (attempt - 1);
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new DedaoApiError(`响应不是 JSON（HTTP ${res.status}）`, res.status, false);
      }
      if (json.success === false) {
        const err = (json.error ?? {}) as Record<string, unknown>;
        const retryable = err.retryable === true;
        const msg = String(err.message ?? `API 错误（HTTP ${res.status}）`);
        if (retryable && attempt < maxRetries) {
          attempt += 1;
          await sleep(3000 * 2 ** (attempt - 1));
          continue;
        }
        throw new DedaoApiError(msg, res.status, retryable);
      }
      return json;
    }
  }

  /** 拉一页 note/list（since_id 游标，"0" = 最新） */
  async listNotes(sinceId: string): Promise<ListNotesResult> {
    const json = await this.getJson(`/resource/note/list?since_id=${encodeURIComponent(sinceId || '0')}`);
    const data = (json.data ?? {}) as Record<string, unknown>;
    const notes = Array.isArray(data.notes) ? (data.notes as RawNoteItem[]) : [];
    const hasMore = data.has_more === true;
    const nextCursor =
      typeof data.next_cursor === 'string' && data.next_cursor
        ? data.next_cursor
        : notes.length
          ? String(notes[notes.length - 1].note_id ?? '0')
          : sinceId;
    return { notes, hasMore, nextCursor };
  }

  /** 单条笔记详情（备用：修复/补数据用） */
  async noteDetail(id: string): Promise<RawNoteItem | null> {
    const json = await this.getJson(`/resource/note/detail?id=${encodeURIComponent(id)}`);
    const data = (json.data ?? {}) as Record<string, unknown>;
    const note = (data.note ?? null) as RawNoteItem | null;
    return note;
  }

  /**
   * 沿 note/list 游标向更旧方向走若干页。
   * 中断安全：调用方每轮只给 maxPages，游标由 reachedCursor 带回。
   */
  async walk(opts: WalkOptions): Promise<WalkResult> {
    let sinceId = opts.startSinceId || '0';
    const collected: RawNoteItem[] = [];
    let pages = 0;
    let reachedEnd = false;
    let stoppedByCutoff = false;
    let reachedCursor = sinceId;

    while (pages < Math.max(1, opts.maxPages)) {
      const res = await this.listNotes(sinceId);
      pages += 1;
      reachedCursor = res.nextCursor || sinceId;

      const stop = opts.onPage?.({ page: pages, notes: res.notes, hasMore: res.hasMore });
      if (stop === false) {
        stoppedByCutoff = true;
        break;
      }

      collected.push(...res.notes);

      if (opts.stopBelowId) {
        const minId = res.notes.length ? res.notes[res.notes.length - 1].note_id : undefined;
        // note/list 按新→旧返回：页尾即本页最旧
        if (minId && idLessOrEqual(minId, opts.stopBelowId)) {
          stoppedByCutoff = true;
          break;
        }
      }

      if (!res.hasMore || res.notes.length === 0) {
        reachedEnd = true;
        break;
      }
      sinceId = res.nextCursor;
    }
    return { pages, notes: collected, reachedCursor, reachedEnd, stoppedByCutoff };
  }
}

/** note_id 字符串按 BigInt 语义比较：a <= b */
export function idLessOrEqual(a: string, b: string): boolean {
  try {
    return BigInt(a) <= BigInt(b);
  } catch {
    return a <= b;
  }
}

/**
 * 把原始 note/list 条目转成 RefNote。
 * 判据（2026-09 实测）：note_type === 'ref'（得到电子书划线，正文在 ref_content）。
 * 同一条 ref 的 content 字段 = 用户写在划线上的想法（得到 App 黑色文字，原文灰色）。
 * 书归属：优先取 topics[0]（实测 ref 的 topics[0] 即书库）。
 */
export function toRefNote(raw: RawNoteItem): RefNote | null {
  if ((raw.note_type ?? '') !== 'ref') return null;
  const uid = String(raw.note_id ?? '');
  if (!uid) return null;
  const topics = Array.isArray(raw.topics) ? raw.topics : [];
  const first = topics[0];
  const bookTopicId = first?.id != null ? String(first.id) : '';
  const bookName = typeof first?.name === 'string' ? first.name : '';
  const text = (raw.ref_content ?? '').trim() || (raw.content ?? '').trim();
  const comment = raw.ref_content?.trim() ? (raw.content ?? '').trim() : '';
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(t => (typeof t?.name === 'string' ? t.name : '')).filter(Boolean)
    : [];
  return {
    uid,
    bookTopicId,
    bookName,
    text,
    comment,
    tags,
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? raw.created_at ?? '',
    allTopicIds: topics.map(t => (t?.id != null ? String(t.id) : '')).filter(Boolean),
  };
}
