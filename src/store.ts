import type { BookEntry, PluginData, RefNote } from './types';

/** BigInt 语义比较 note_id（64 位数字字符串，防精度问题用字符串存储） */
export function idCompare(a: string, b: string): number {
  const ba = BigInt(a || '0');
  const bb = BigInt(b || '0');
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}

/** 无书库归属的划线归入此伪书（得到课程/被删书库的划线），用户可在书单里选择是否同步 */
export const ORPHAN_TOPIC_ID = '__orphan__';
export const ORPHAN_BOOK_NAME = '未归书划线';

/**
 * 从划线 refs 推导书库注册表。
 * 只有真的含 ref 划线的 topic 才会出现 → 天然无误报。
 * 保留人工 ignore 标记与既有排序。
 */
export function deriveBooks(refs: RefNote[], prevBooks: BookEntry[] = []): BookEntry[] {
  const prev = new Map(prevBooks.map(b => [b.topicId, b]));
  const map = new Map<string, { name: string; count: number; last: string }>();
  for (const ref of refs) {
    const topicId = ref.bookTopicId || ORPHAN_TOPIC_ID;
    const name = ref.bookName || ORPHAN_BOOK_NAME;
    const entry = map.get(topicId);
    const lastAt = ref.updatedAt || ref.createdAt || '';
    if (!entry) {
      map.set(topicId, { name, count: 1, last: lastAt });
    } else {
      entry.count += 1;
      if (lastAt > entry.last) entry.last = lastAt;
    }
  }
  const books: BookEntry[] = [];
  for (const [topicId, v] of map) {
    const before = prev.get(topicId);
    books.push({
      topicId,
      name: v.name || before?.name || topicId,
      refCount: v.count,
      lastRefAt: v.last,
      ignored: before?.ignored ?? false,
    });
  }
  // 稳定排序：最近有划线的书在前；伪书（无归属）永远垫底
  books.sort((a, b) => {
    if (a.topicId === ORPHAN_TOPIC_ID) return 1;
    if (b.topicId === ORPHAN_TOPIC_ID) return -1;
    return a.lastRefAt < b.lastRefAt ? 1 : a.lastRefAt > b.lastRefAt ? -1 : 0;
  });
  return books;
}

/**
 * 计算每条划线在其「书 × 同一天」内的序号（按 created_at 升序，1 开始）。
 * 同一秒多条时按 uid 稳定排序，保证多次计算结果一致。
 */
export function computeSeqMap(refs: RefNote[]): Map<string, number> {
  const groups = new Map<string, RefNote[]>();
  for (const ref of refs) {
    const topicId = ref.bookTopicId || ORPHAN_TOPIC_ID;
    const day = (ref.createdAt || '').slice(0, 10);
    const key = `${topicId}::${day}`;
    const list = groups.get(key);
    if (list) list.push(ref);
    else groups.set(key, [ref]);
  }
  const seq = new Map<string, number>();
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const c = (a.createdAt || '').localeCompare(b.createdAt || '');
      return c !== 0 ? c : a.uid.localeCompare(b.uid);
    });
    list.forEach((ref, i) => seq.set(ref.uid, i + 1));
  }
  return seq;
}

/** 合并新拉到的划线进仓库（按 uid 去重，新数据覆盖旧数据） */
export function mergeRefs(existing: RefNote[], incoming: RefNote[]): { refs: RefNote[]; added: number; updated: number } {
  const map = new Map(existing.map(r => [r.uid, r]));
  let added = 0;
  let updated = 0;
  for (const ref of incoming) {
    if (map.has(ref.uid)) updated += 1;
    else added += 1;
    map.set(ref.uid, ref);
  }
  return { refs: Array.from(map.values()), added, updated };
}

/** 数据总条数守卫：refs 仓库超上限时截断最旧的（防 data.json 无限膨胀） */
export const MAX_REFS = 20000;

export function ensureDataShape(data: PluginData): PluginData {
  if (data.refs.length > MAX_REFS) {
    data.refs.sort((a, b) => idCompare(b.uid, a.uid));
    data.refs = data.refs.slice(0, MAX_REFS);
  }
  return data;
}
