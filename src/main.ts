import { Notice, Plugin, TFile, TFolder, normalizePath } from 'obsidian';
import { DedaoClient, DedaoApiError } from './api';
import { runFullCycle, syncBooks, type FileStore } from './engine';
import { mergeData, type PluginData } from './types';
import { DedaoBookSyncSettingTab } from './settings';

export default class DedaoBookSyncPlugin extends Plugin {
  data!: PluginData;
  private autoSyncId: number | undefined;
  private running = false;

  override async onload(): Promise<void> {
    this.data = mergeData(await this.loadData());

    this.addRibbonIcon('book-open', '得到书籍同步：拉取并同步', () => {
      void this.runCycle();
    });

    this.addCommand({
      id: 'fetch-and-sync-books',
      name: '拉取并同步书籍划线',
      callback: () => void this.runCycle(),
    });

    this.addCommand({
      id: 'sync-books-local-only',
      name: '仅落盘：把已拉取的划线写入本地（不请求 API）',
      callback: () => void this.runSyncOnly(),
    });

    this.addCommand({
      id: 'reset-backfill-cursor',
      name: '重置全量回捞游标（下次从头走库）',
      callback: () => {
        this.data.state.backfillCursor = '';
        this.data.state.backfillDone = false;
        void this.saveData(this.data);
        new Notice('已重置回捞游标，下次拉取将从头走一遍 note/list');
      },
    });

    this.addSettingTab(new DedaoBookSyncSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.data.settings.syncOnStart) void this.runCycle();
    });
    this.restartScheduler();
  }

  override onunload(): void {
    if (this.autoSyncId !== undefined) window.clearInterval(this.autoSyncId);
  }

  restartScheduler(): void {
    if (this.autoSyncId !== undefined) {
      window.clearInterval(this.autoSyncId);
      this.autoSyncId = undefined;
    }
    if (!this.data.settings.autoSyncEnabled) return;
    const ms = Math.max(5, this.data.settings.intervalMinutes) * 60 * 1000;
    this.autoSyncId = window.setInterval(() => void this.runCycle(), ms);
    this.registerInterval(this.autoSyncId);
  }

  private client(): DedaoClient {
    return new DedaoClient(this.data.settings.apiToken, this.data.settings.clientId, {
      delayMs: this.data.settings.requestDelayMs,
    });
  }

  /** Obsidian vault 适配的文件系统 */
  private fileStore(): FileStore {
    const vault = this.app.vault;
    return {
      ensureDir: async (dir: string) => {
        const normalized = normalizePath(dir);
        const parts = normalized.split('/').filter(Boolean);
        let cur = '';
        for (const part of parts) {
          cur = cur ? `${cur}/${part}` : part;
          const existing = vault.getAbstractFileByPath(cur);
          if (!existing) await vault.createFolder(cur);
          else if (!(existing instanceof TFolder)) throw new Error(`路径被同名文件占用：${cur}`);
        }
      },
      readUidIndex: async (root: string) => {
        const index = new Map<string, string>();
        const prefix = normalizePath(root) + '/';
        for (const file of vault.getMarkdownFiles()) {
          if (!file.path.startsWith(prefix)) continue;
          const uid = this.app.metadataCache.getFileCache(file)?.frontmatter?.['uid'];
          if (typeof uid === 'string' && uid) index.set(uid, file.path);
        }
        return index;
      },
      readFile: async (path: string) => {
        const f = vault.getAbstractFileByPath(normalizePath(path));
        return f instanceof TFile ? vault.read(f) : null;
      },
      writeFile: async (path: string, content: string) => {
        const normalized = normalizePath(path);
        const existing = vault.getAbstractFileByPath(normalized);
        if (existing instanceof TFile) await vault.modify(existing, content);
        else await vault.create(normalized, content);
      },
    };
  }

  /** 拉取 + 推导书单 + 落盘 */
  async runCycle(onPage?: (done: number, total: number | null) => void): Promise<void> {
    if (this.running) {
      new Notice('书籍同步正在进行中，请稍候');
      return;
    }
    if (!this.data.settings.apiToken) {
      new Notice('请先在设置里填写得到大脑 apiToken');
      return;
    }
    this.running = true;
    const notice = new Notice('得到书籍同步：拉取中…', 0);
    try {
      const result = await runFullCycle(
        this.data,
        this.data.settings,
        this.client(),
        this.fileStore(),
        msg => new Notice(msg, 4000),
        onPage,
      );
      this.data.lastSyncAt = Date.now();
      await this.saveData(this.data);
      const f = result.fetch;
      const s = result.sync;
      new Notice(
        `得到书籍同步完成：请求 ${f.pagesFetched} 页 · 新增划线 ${f.refsAdded} · 落盘新建 ${s.created} · 更新 ${s.updated} · 已存在跳过 ${s.skipped}` +
          (f.backfillDone ? '\n全量回捞已完成' : '\n全量回捞进行中（继续点「立即同步」即可分批跑完）'),
        8000,
      );
    } catch (err) {
      await this.saveData(this.data); // 游标已推进的部分不丢
      const msg = err instanceof DedaoApiError ? err.message : String(err);
      new Notice(`得到书籍同步失败：${msg}\n（进度已保存，再次触发即可续传）`, 10000);
      console.error('[DedaoBookSync]', err);
    } finally {
      notice.hide();
      this.running = false;
    }
  }

  /** 仅落盘（零 API） */
  async runSyncOnly(): Promise<void> {
    try {
      const stats = await syncBooks(this.data, this.data.settings, this.fileStore(), msg => new Notice(msg, 4000));
      await this.saveData(this.data);
      new Notice(`落盘完成：新建 ${stats.created} · 更新 ${stats.updated} · 跳过 ${stats.skipped}`, 6000);
    } catch (err) {
      new Notice(`落盘失败：${String(err)}`, 8000);
      console.error('[DedaoBookSync]', err);
    }
  }
}
