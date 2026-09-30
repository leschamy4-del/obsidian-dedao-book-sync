/** 纯函数：路径与文件名（不依赖 Obsidian / node） */

/** 替换 Obsidian/Windows 文件名非法字符 */
export function sanitizeSegment(name: string): string {
  return (name ?? '').replace(/[\\/:*?"<>|#^\[\]]/g, '_').trim();
}

/** 书籍落位目录：<root>/<书名> */
export function getBookDir(root: string, bookName: string): string {
  const r = (root || '00-Inbox/书籍').replace(/\/+$/, '');
  const seg = sanitizeSegment(bookName) || '未命名书籍';
  return `${r}/${seg}`;
}

/** "2026-08-11 08:36:04" → "2026年08月11日" */
export function datePrefix(datetime: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime ?? '');
  if (!m) return '未知日期';
  return `${m[1]}年${m[2]}月${m[3]}日`;
}

/** 划线摘要（用于文件名/标题）：去换行，截断 */
export function highlightSummary(text: string, maxLen = 20): string {
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '无正文划线';
  return Array.from(cleaned).slice(0, maxLen).join('');
}

export function padSeq(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 书籍嵌套标签：#书籍/<书名>。标签字符集比文件名严格：全角/ASCII 冒号与空格都换成连字符 */
export function bookTagFor(bookName: string): string {
  const tag = sanitizeSegment(bookName)
    .replace(/[:：]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `#书籍/${tag || '未命名'}`;
}

/**
 * 划线笔记文件名：YYYY年MM月DD日_NN_摘要20字.md
 * NN 为同一本书同一天内的序号（按 created_at 升序），由 computeSeqMap 稳定计算
 */
export function buildFileName(createdAt: string, seq: number, text: string): string {
  const summary = sanitizeSegment(highlightSummary(text, 20)) || '划线';
  return `${datePrefix(createdAt)}_${padSeq(seq)}_${summary}.md`;
}
