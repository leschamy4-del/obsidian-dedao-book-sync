/** 得到大脑 OpenAPI 数据形态（2026-09 实测） */

/** note/list 或 note/detail 返回的笔记（只保留插件用到的字段） */
export interface RawNoteItem {
  note_id: string;
  title?: string;
  content?: string;
  ref_content?: string;
  note_type?: string;
  source?: string;
  tags?: Array<{ name?: string }>;
  topics?: Array<{ id?: string | number; name?: string }>;
  is_child_note?: boolean;
  children_count?: number;
  created_at?: string;
  updated_at?: string;
}

/** refs 仓库里持久化的划线笔记（纯化后的形状） */
export interface RefNote {
  uid: string;
  bookTopicId: string;
  bookName: string;
  /** 划线正文（note/list 的 ref_content；为空则回退 content） */
  text: string;
  /** 用户在划线上写的想法（note/list 的 content；得到 App 里显示为黑色文字，原文为灰色） */
  comment: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** 归属多个库时保留全部 topicId，便于排查 */
  allTopicIds: string[];
}

/** 书库注册表条目（由 refs 仓库推导 + 人工覆盖） */
export interface BookEntry {
  topicId: string;
  name: string;
  refCount: number;
  lastRefAt: string;
  /** 手动从书单里隐藏（比如某个知识库里存过一条划线） */
  ignored?: boolean;
}

export interface FetchState {
  /** 已见过的最新 note_id（增量同步的截止线） */
  maxSeenId: string;
  /** 全量回捞游标：已走到的最旧 note_id；空 = 未开始 */
  backfillCursor: string;
  /** 全量回捞是否完成（走到底） */
  backfillDone: boolean;
  lastFetchAt?: number;
}

export type IntervalTier = 5 | 10 | 20 | 30 | 60 | 720 | 1440 | 10080;

export interface Settings {
  apiToken: string;
  clientId: string;
  /** 书籍落位根目录（vault 绝对路径），默认 00-Inbox/书籍 */
  rootFolder: string;
  autoSyncEnabled: boolean;
  /** 8 档间隔（分钟） */
  intervalMinutes: IntervalTier;
  /** Obsidian 启动时立即跑一轮 */
  syncOnStart: boolean;
  /** 勾选要同步的书籍 topicId */
  selectedTopicIds: string[];
  /** 全量回捞每轮最多走多少页（20 条/页），防限流分批跑 */
  backfillPagesPerRun: number;
  /** 请求间隔毫秒（限流保护） */
  requestDelayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  apiToken: '',
  clientId: '',
  rootFolder: '00-Inbox/书籍',
  autoSyncEnabled: false,
  intervalMinutes: 1440,
  syncOnStart: false,
  selectedTopicIds: [],
  backfillPagesPerRun: 40,
  requestDelayMs: 1200,
};

export interface PluginData {
  settings: Settings;
  refs: RefNote[];
  books: BookEntry[];
  state: FetchState;
  lastSyncAt?: number;
}

export const DEFAULT_DATA: PluginData = {
  settings: { ...DEFAULT_SETTINGS },
  refs: [],
  books: [],
  state: { maxSeenId: '', backfillCursor: '', backfillDone: false },
};

export const INTERVAL_TIERS: ReadonlyArray<{ value: IntervalTier; label: string }> = [
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 20, label: '20 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '1 天' },
  { value: 10080, label: '1 周' },
];

export function mergeData(raw: unknown): PluginData {
  const obj = (raw ?? {}) as Partial<PluginData>;
  return {
    settings: { ...DEFAULT_SETTINGS, ...(obj.settings ?? {}) },
    refs: Array.isArray(obj.refs) ? obj.refs : [],
    books: Array.isArray(obj.books) ? obj.books : [],
    state: { ...DEFAULT_DATA.state, ...(obj.state ?? {}) },
    lastSyncAt: obj.lastSyncAt,
  };
}
