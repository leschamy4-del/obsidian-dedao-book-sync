import type { RefNote } from './types';
import { bookTagFor, datePrefix } from './paths';

/** YAML 双引号值转义 */
function escapeYaml(value: string): string {
  return (value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/** frontmatter 标题：划线摘要（前端展示用） */
function displayTitle(text: string): string {
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '划线';
  return Array.from(cleaned).slice(0, 30).join('');
}

/** 清洗成 Obsidian 嵌套标签片段 */
function tagSegment(name: string): string {
  return (name ?? '').trim().replace(/\s+/g, '-').replace(/[\\/:*?"<>|]/g, '');
}

/**
 * 渲染一条书籍划线为完整 Markdown。
 * 形状（2026-09 与用户确认）：
 *  - frontmatter: uid/title/created/modified/source/note_type/tags/book
 *  - 正文: 书名引用块 + 划线原文 + uid 脚注
 */
export function renderHighlight(ref: RefNote, seq: number, seqPad: (n: number) => string): string {
  const tags = [...ref.tags.map(tagSegment).filter(Boolean), bookTagFor(ref.bookName)];
  const tagItems = Array.from(new Set(tags)).map(t => `"${escapeYaml(t)}"`);
  const title = displayTitle(ref.text);

  const frontmatter = [
    '---',
    `uid: "${escapeYaml(ref.uid)}"`,
    `title: "${escapeYaml(title)}"`,
    `created: ${ref.createdAt || ''}`,
    `modified: ${ref.updatedAt || ref.createdAt || ''}`,
    `source: 得到大脑`,
    `note_type: ref`,
    `book: "${escapeYaml(ref.bookName)}"`,
    `tags: [${tagItems.join(', ')}]`,
    '---',
    '',
  ].join('\n');

  const bodyParts: string[] = [
    `> 📖 **${escapeYaml(ref.bookName)}**`,
    `> 划线 · ${datePrefix(ref.createdAt)}`,
    '',
    ref.text || '_(空划线)_',
  ];

  // 用户写在划线上的想法（得到 App 里黑色文字；原文为灰色）
  const comment = (ref.comment ?? '').trim();
  if (comment) {
    bodyParts.push('', '## 💭 我的想法', '', comment);
  }

  bodyParts.push('', '---', `> 得到电子书划线 · uid ${ref.uid}`, '');
  const body = bodyParts.join('\n');

  return frontmatter + body;
}
