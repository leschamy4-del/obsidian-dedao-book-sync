import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSegment, getBookDir, datePrefix, highlightSummary, buildFileName, bookTagFor, padSeq } from '../src/paths';
import { renderHighlight } from '../src/render';
import { deriveBooks, computeSeqMap, mergeRefs, idCompare, ORPHAN_TOPIC_ID } from '../src/store';
import { toRefNote, idLessOrEqual } from '../src/api';
import { runFetchCycle, syncBooks, type FileStore } from '../src/engine';
import { DEFAULT_DATA, type PluginData, type RawNoteItem, type RefNote } from '../src/types';

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

function rawRef(overrides: Partial<RawNoteItem> = {}): RawNoteItem {
  return {
    note_id: '1001',
    title: '',
    content: '',
    ref_content: '测试划线正文',
    note_type: 'ref',
    source: 'dedao',
    tags: [{ name: '得到' }, { name: '测试书' }],
    topics: [{ id: 'T1', name: '测试书' }],
    created_at: '2026-08-11 08:36:04',
    updated_at: '2026-08-11 08:36:04',
    ...overrides,
  };
}

function ref(overrides: Partial<RefNote> = {}): RefNote {
  return {
    uid: '1001',
    bookTopicId: 'T1',
    bookName: '测试书',
    text: '测试划线正文',
    comment: '',
    tags: ['得到'],
    createdAt: '2026-08-11 08:36:04',
    updatedAt: '2026-08-11 08:36:04',
    allTopicIds: ['T1'],
    ...overrides,
  };
}

// ---------- paths ----------
test('paths: sanitize 非法字符与书名目录', () => {
  // 全角冒号（真实书名用的）在 Windows/Obsidian 合法，保留；ASCII 非法字符才替换
  assert.equal(sanitizeSegment('纳瓦尔宝典：财富与幸福指南'), '纳瓦尔宝典：财富与幸福指南');
  assert.equal(sanitizeSegment('a:b*c?d'), 'a_b_c_d');
  assert.equal(getBookDir('00-Inbox/书籍', '长安的荔枝'), '00-Inbox/书籍/长安的荔枝');
  assert.equal(getBookDir('00-Inbox/书籍/', 'a/b*c'), '00-Inbox/书籍/a_b_c');
  assert.equal(datePrefix('2026-08-11 08:36:04'), '2026年08月11日');
  assert.equal(highlightSummary('  但在确定前进的方向之前，\n你需要知道  ', 10), '但在确定前进的方向之');
  assert.equal(padSeq(7), '07');
  assert.equal(bookTagFor('人生设计课：如何设计'), '#书籍/人生设计课-如何设计');
  assert.match(buildFileName('2026-08-11 08:36:04', 3, '正文一二三四五'), /^2026年08月11日_03_正文一二三四五\.md$/);
});

// ---------- render ----------
test('render: frontmatter 与正文形状', () => {
  const md = renderHighlight(ref(), 2, pad);
  assert.ok(md.includes('uid: "1001"'));
  assert.ok(md.includes('note_type: ref'));
  assert.ok(md.includes('book: "测试书"'));
  assert.ok(md.includes('"得到"'));
  assert.ok(md.includes('#书籍/测试书'));
  assert.ok(md.includes('测试划线正文'));
  assert.ok(md.startsWith('---\n'));
  assert.ok(!md.includes('我的想法'), '无想法时不应出现想法区块');
});

test('render: 划线带想法时渲染 💭 区块', () => {
  const md = renderHighlight(ref({ comment: '我有时候总想大框架，想多功能。' }), 1, pad);
  assert.ok(md.includes('## 💭 我的想法'));
  assert.ok(md.includes('我有时候总想大框架，想多功能。'));
  // 顺序：原文在前、想法在后
  assert.ok(md.indexOf('测试划线正文') < md.indexOf('## 💭 我的想法'));
});

// ---------- store ----------
test('store: deriveBooks 聚合与忽略标记保留', () => {
  const refs = [ref({ uid: '1' }), ref({ uid: '2', createdAt: '2026-09-01 10:00:00', updatedAt: '2026-09-01 10:00:00' }), ref({ uid: '3', bookTopicId: 'T2', bookName: '第二本' })];
  const books = deriveBooks(refs, [{ topicId: 'T2', name: '第二本', refCount: 9, lastRefAt: '', ignored: true }]);
  assert.equal(books.length, 2);
  const t1 = books.find(b => b.topicId === 'T1')!;
  const t2 = books.find(b => b.topicId === 'T2')!;
  assert.equal(t1.refCount, 2);
  assert.equal(t1.lastRefAt, '2026-09-01 10:00:00');
  assert.equal(t2.ignored, true);
});

test('store/engine: 无归属划线进未归书伪书且默认不落盘', async () => {
  const refs = [
    ref({ uid: '10', bookTopicId: '', bookName: '', text: '无归属课程划线' }),
    ref({ uid: '11', bookTopicId: 'T1', text: '正常书划线' }),
  ];
  const books = deriveBooks(refs);
  const orphan = books.find(b => b.topicId === ORPHAN_TOPIC_ID);
  assert.ok(orphan, '伪书应出现在书单');
  assert.equal(orphan!.name, '未归书划线');
  assert.equal(orphan!.refCount, 1);
  assert.equal(books[books.length - 1].topicId, ORPHAN_TOPIC_ID, '伪书排序垫底');

  // 只勾选真书 → 伪书不落盘
  const data = dataWith(refs);
  const settings = { ...DEFAULT_DATA.settings, rootFolder: '00-Inbox/书籍', selectedTopicIds: ['T1'] };
  const store = memoryStore();
  const s = await syncBooks(data, settings, store);
  assert.equal(s.created, 1);
  assert.ok(!Array.from(store.files.keys()).some(p => p.includes('未归书划线')));

  // 勾选伪书 → 落盘到 未归书划线/
  const s2 = await syncBooks(data, { ...settings, selectedTopicIds: ['T1', ORPHAN_TOPIC_ID] }, store);
  assert.equal(s2.created, 1);
  const orphanPath = Array.from(store.files.keys()).find(p => p.includes('未归书划线'))!;
  assert.ok(orphanPath, '应写入 未归书划线/ 目录');
});

test('store: computeSeqMap 同书同日序号稳定', () => {
  const refs = [
    ref({ uid: 'b', createdAt: '2026-08-11 09:00:00' }),
    ref({ uid: 'a', createdAt: '2026-08-11 08:00:00' }),
    ref({ uid: 'c', createdAt: '2026-08-12 08:00:00' }),
  ];
  const seq = computeSeqMap(refs);
  assert.equal(seq.get('a'), 1);
  assert.equal(seq.get('b'), 2);
  assert.equal(seq.get('c'), 1);
});

test('store: mergeRefs 去重合并', () => {
  const { refs, added, updated } = mergeRefs([ref({ uid: '1' })], [ref({ uid: '1', text: '新版' }), ref({ uid: '2' })]);
  assert.equal(refs.length, 2);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.equal(refs.find(r => r.uid === '1')!.text, '新版');
});

test('store: idCompare BigInt 语义', () => {
  // BigInt 语义：9 < 10（字符串比较会得出 9 > 10，那是错的）
  assert.ok(idCompare('9', '10') < 0);
  assert.ok(idCompare('10', '9') > 0);
  assert.ok(idLessOrEqual('1922595487110812864', '1922595487110813000'));
});

// ---------- api: toRefNote ----------
test('api: toRefNote 只收 ref 且取 topics[0]', () => {
  assert.equal(toRefNote({ note_id: '1', note_type: 'plain_text' }), null);
  const r = toRefNote(rawRef({ topics: [{ id: 'T1', name: '书A' }, { id: 'T9', name: '某知识库' }] }))!;
  assert.equal(r.bookTopicId, 'T1');
  assert.equal(r.allTopicIds.length, 2);
  assert.equal(r.text, '测试划线正文');
  assert.equal(r.comment, '', 'content 为空时想法为空');
});

test('api: toRefNote 捕获划线想法（content）', () => {
  // ref 同时有 ref_content（原文）与 content（想法）→ 各归各位
  const r = toRefNote(rawRef({ content: '我总想大框架，想多功能。' }))!;
  assert.equal(r.text, '测试划线正文');
  assert.equal(r.comment, '我总想大框架，想多功能。');
  // 无 ref_content 的 ref：content 回退为正文，想法留空（不重复）
  const r2 = toRefNote(rawRef({ note_id: '2', ref_content: undefined, content: '纯想法内容' }))!;
  assert.equal(r2.text, '纯想法内容');
  assert.equal(r2.comment, '');
});

// ---------- engine ----------
function memoryStore(): FileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    ensureDir: async () => {},
    readUidIndex: async root => {
      const idx = new Map<string, string>();
      for (const [path, content] of files) {
        if (!path.startsWith(root + '/')) continue;
        const m = /uid: "(\d+)"/.exec(content);
        if (m) idx.set(m[1], path);
      }
      return idx;
    },
    readFile: async p => files.get(p) ?? null,
    writeFile: async (p, c) => {
      files.set(p, c);
    },
  };
}

/** 假客户端：按「最新→最旧」预排的页序列回放（startSinceId=页尾 id 则从下一页开始） */
function fakeClient(pages: RawNoteItem[][]) {
  return {
    walk: async (o: { startSinceId: string; maxPages: number; stopBelowId?: string; onPage?: (i: unknown) => void }) => {
      let startIdx: number;
      if (o.startSinceId === '0') startIdx = 0;
      else {
        const found = pages.findIndex(pg => pg.length && pg[pg.length - 1].note_id === o.startSinceId);
        startIdx = found >= 0 ? found + 1 : pages.length;
      }
      const collected: RawNoteItem[] = [];
      let p = 0;
      let stopped = false;
      let reachedEnd = false;
      for (; startIdx + p < pages.length && p < o.maxPages; p++) {
        const pageNotes = pages[startIdx + p];
        o.onPage?.({ page: p + 1, notes: pageNotes });
        collected.push(...pageNotes);
        if (o.stopBelowId) {
          const minId = pageNotes[pageNotes.length - 1]?.note_id;
          if (minId && idLessOrEqual(minId, o.stopBelowId)) {
            stopped = true;
            break;
          }
        }
      }
      if (startIdx + p >= pages.length) reachedEnd = true;
      const lastPage = collected.length ? collected[collected.length - 1].note_id : o.startSinceId;
      return { pages: p, notes: collected, reachedCursor: lastPage || o.startSinceId, reachedEnd, stoppedByCutoff: stopped };
    },
  };
}

function dataWith(refs: RefNote[], state: Partial<PluginData['state']> = {}): PluginData {
  return { ...DEFAULT_DATA, refs, state: { ...DEFAULT_DATA.state, ...state } };
}

test('engine: 全量回捞分页推进 + 增量截止', async () => {
  const page = (ids: number[], type: string = 'ref'): RawNoteItem[] =>
    ids.map(id =>
      type === 'ref'
        ? rawRef({ note_id: String(id), ref_content: `划线${id}`, created_at: '2026-08-11 08:36:04' })
        : rawRef({ note_id: String(id), note_type: 'plain_text', content: '普通笔记', ref_content: undefined }),
    );

  // 全库 3 页：newest → oldest
  const pages = [page([300, 299]), page([298, 100]), page([99, 1])];
  const client = fakeClient(pages);
  const data = dataWith([], { maxSeenId: '', backfillCursor: '', backfillDone: false });

  // 第 1 轮：增量跳过（maxSeenId 为空），回捞走 1 页 [300,299]
  const s1 = await runFetchCycle(data, client as never, { backfillPagesPerRun: 1, delayMs: 0 });
  assert.equal(s1.pagesFetched, 1);
  assert.equal(data.state.backfillCursor, '299');
  assert.equal(data.refs.length, 2);
  assert.equal(data.state.maxSeenId, '300'); // 回捞顺手记录最新 id
  assert.equal(s1.backfillDone, false);

  // 第 2 轮：增量从 300 截止（无新笔记）；回捞再走 1 页 [298,100]
  const s2 = await runFetchCycle(data, client as never, { backfillPagesPerRun: 1, delayMs: 0 });
  assert.ok(s2.incrementalDone);
  assert.equal(data.state.maxSeenId, '300');
  assert.equal(data.refs.length, 4);
  assert.equal(data.state.backfillCursor, '100');

  // 第 3 轮：回捞走到底
  const s3 = await runFetchCycle(data, client as never, { backfillPagesPerRun: 1, delayMs: 0 });
  console.error('DBG s3:', JSON.stringify(s3), '| state:', JSON.stringify(data.state), '| refs:', data.refs.length);
  assert.equal(s3.backfillDone, true);
  assert.equal(data.refs.length, 6); // 300,299,298,100,99,1
});

test('engine: syncBooks 幂等落盘', async () => {
  const data = dataWith([
    ref({ uid: '1', bookName: '测试书', text: '第一条' }),
    ref({ uid: '2', bookName: '测试书', text: '第二条', createdAt: '2026-08-11 09:00:00' }),
    ref({ uid: '3', bookTopicId: 'T2', bookName: '没选的书' }),
  ]);
  const settings = { ...DEFAULT_DATA.settings, rootFolder: '00-Inbox/书籍', selectedTopicIds: ['T1'] };
  const store = memoryStore();

  const s1 = await syncBooks(data, settings, store);
  assert.equal(s1.created, 2);
  assert.equal(s1.skipped, 0);
  const paths1 = Array.from(store.files.keys()).sort();
  assert.ok(paths1[0].includes('00-Inbox/书籍/测试书/'));
  assert.ok(paths1[0].includes('_01_'));
  assert.ok(paths1[1].includes('_02_'));

  const s2 = await syncBooks(data, settings, store);
  assert.equal(s2.created, 0);
  assert.equal(s2.skipped, 2);
  assert.equal(s2.updated, 0);

  // 给已有划线补上想法 → 内容变化 → 原地更新（不新建文件）
  data.refs[0].comment = '补写的一条想法';
  const s3 = await syncBooks(data, settings, store);
  assert.equal(s3.created, 0);
  assert.equal(s3.updated, 1);
  assert.equal(s3.skipped, 1);
  const file1 = Array.from(store.files.values()).find(c => c.includes('uid: "1"'))!;
  assert.ok(file1.includes('## 💭 我的想法'));
  assert.ok(file1.includes('补写的一条想法'));

  // 再跑一轮：内容稳定 → 全部跳过
  const s4 = await syncBooks(data, settings, store);
  assert.equal(s4.created, 0);
  assert.equal(s4.updated, 0);
  assert.equal(s4.skipped, 2);
});
