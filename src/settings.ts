import { App, AbstractInputSuggest, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type DedaoBookSyncPlugin from './main';
import { INTERVAL_TIERS } from './types';

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement, private readonly onSelectCb: (path: string) => void) {
    super(app, inputEl);
  }
  override getSuggestions(query: string): TFolder[] {
    const q = (query ?? '').toLowerCase();
    return this.app.vault
      .getAllFolders()
      .filter(f => !q || f.path.toLowerCase().includes(q));
  }
  override renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }
  override selectSuggestion(folder: TFolder): void {
    this.onSelectCb(folder.path);
    this.close();
  }
}

export class DedaoBookSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DedaoBookSyncPlugin) {
    super(app, plugin);
  }

  private async persist(): Promise<void> {
    await this.plugin.saveData(this.plugin.data);
    this.plugin.restartScheduler();
    this.display();
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.data.settings;
    const state = this.plugin.data.state;

    containerEl.createEl('h2', { text: '得到书籍同步（Dedao Book Sync）' });

    // ---------- 凭据 ----------
    new Setting(containerEl).setName('凭据').setHeading();
    new Setting(containerEl)
      .setName('apiToken')
      .setDesc('得到大脑 OpenAPI 的 Bearer Token（与 dedao-kb-sync 里同一个）')
      .addText(t => {
        t.inputEl.type = 'password';
        t.inputEl.style.width = '100%';
        t.setValue(s.apiToken).onChange(async v => {
          s.apiToken = v.trim();
          await this.plugin.saveData(this.plugin.data);
        });
      });
    new Setting(containerEl)
      .setName('clientId')
      .setDesc('OpenAPI 的 X-Client-ID')
      .addText(t => {
        t.inputEl.style.width = '100%';
        t.setValue(s.clientId).onChange(async v => {
          s.clientId = v.trim();
          await this.plugin.saveData(this.plugin.data);
        });
      });

    // ---------- 落位 ----------
    new Setting(containerEl).setName('落位').setHeading();
    new Setting(containerEl)
      .setName('书籍根目录')
      .setDesc('每本书一个子文件夹：书籍/<书名>/，每条划线一个 md')
      .addText(t => {
        t.inputEl.style.width = '100%';
        t.setValue(s.rootFolder).onChange(v => {
          s.rootFolder = v.trim();
        });
        new FolderSuggest(this.app, t.inputEl, path => {
          s.rootFolder = path;
          t.setValue(path);
          void this.persist();
        });
        t.inputEl.addEventListener('blur', () => void this.persist());
      });

    // ---------- 自动同步 ----------
    new Setting(containerEl).setName('自动同步（独立于知识库同步）').setHeading();
    new Setting(containerEl)
      .setName('启用自动同步')
      .addToggle(t => t.setValue(s.autoSyncEnabled).onChange(async v => {
        s.autoSyncEnabled = v;
        await this.persist();
      }));
    new Setting(containerEl)
      .setName('同步间隔')
      .setDesc('得到 API 有频率/月度配额限制，建议 1 天或更长')
      .addDropdown(d => {
        for (const tier of INTERVAL_TIERS) d.addOption(String(tier.value), tier.label);
        d.setValue(String(s.intervalMinutes)).onChange(async v => {
          s.intervalMinutes = Number(v) as typeof s.intervalMinutes;
          await this.persist();
        });
      });
    new Setting(containerEl)
      .setName('Obsidian 启动时先同步一轮')
      .addToggle(t => t.setValue(s.syncOnStart).onChange(async v => {
        s.syncOnStart = v;
        await this.persist();
      }));

    // ---------- 拉取节奏 ----------
    new Setting(containerEl).setName('拉取节奏（防限流）').setHeading();
    new Setting(containerEl)
      .setName('全量回捞每轮页数')
      .setDesc('每页 20 条笔记；走完自动停，分多轮跑完整个历史')
      .addSlider(sl => {
        sl.setLimits(5, 200, 5).setValue(s.backfillPagesPerRun).setDynamicTooltip()
          .onChange(async v => {
            s.backfillPagesPerRun = v;
            await this.plugin.saveData(this.plugin.data);
          });
      });
    new Setting(containerEl)
      .setName('请求间隔（毫秒）')
      .addText(t => {
        t.setValue(String(s.requestDelayMs)).onChange(async v => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 300) {
            s.requestDelayMs = n;
            await this.plugin.saveData(this.plugin.data);
          }
        });
      });

    // ---------- 回捞进度 ----------
    new Setting(containerEl).setName('回捞进度').setHeading();
    const progressDesc = state.backfillDone
      ? '✅ 全量回捞已完成'
      : state.backfillCursor
        ? `进行中：已走到 note_id ${state.backfillCursor}（继续「立即同步」分批推进）`
        : '未开始';
    new Setting(containerEl).setName('状态').setDesc(progressDesc);
    new Setting(containerEl)
      .setName('最近一次同步')
      .setDesc(this.plugin.data.lastSyncAt ? new Date(this.plugin.data.lastSyncAt).toLocaleString() : '从未');

    // ---------- 书单 ----------
    new Setting(containerEl).setName('同步哪些书').setHeading();
    const books = this.plugin.data.books;
    if (books.length === 0) {
      containerEl.createEl('p', {
        text: '书单来自已拉取的划线数据（只有真的含划线的库才会出现）。先点一次「立即拉取并同步」，或把旧插件的划线导进来。',
      });
    } else {
      const actions = new Setting(containerEl).setName(`共 ${books.length} 本 · 已选 ${s.selectedTopicIds.length}`);
      actions.addButton(b => b.setButtonText('全选').onClick(async () => {
        s.selectedTopicIds = books.filter(b => !b.ignored).map(b => b.topicId);
        await this.persist();
      }));
      actions.addButton(b => b.setButtonText('清空').onClick(async () => {
        s.selectedTopicIds = [];
        await this.persist();
      }));
      const listEl = containerEl.createDiv();
      for (const book of books) {
        const row = new Setting(listEl)
          .setName(book.name)
          .setDesc(`${book.refCount} 条划线 · 最近 ${book.lastRefAt || '-'}`);
        if (book.ignored) {
          row.addButton(b => b.setButtonText('恢复').onClick(async () => {
            book.ignored = false;
            await this.persist();
          }));
        } else {
          const toggle = row.addToggle(t => {
            t.setValue(s.selectedTopicIds.includes(book.topicId)).onChange(async v => {
              const set = new Set(s.selectedTopicIds);
              if (v) set.add(book.topicId);
              else set.delete(book.topicId);
              s.selectedTopicIds = Array.from(set);
              await this.plugin.saveData(this.plugin.data);
            });
            return t;
          });
          void toggle;
          row.addButton(b => b.setButtonText('忽略').onClick(async () => {
            book.ignored = true;
            s.selectedTopicIds = s.selectedTopicIds.filter(id => id !== book.topicId);
            await this.persist();
          }));
        }
      }
    }

    // ---------- 手动操作 ----------
    new Setting(containerEl).setName('手动操作').setHeading();
    new Setting(containerEl)
      .setName('立即拉取并同步')
      .setDesc('走一轮 note/list 拉取（增量 + 回捞分页），然后把勾选书籍的划线写进本地')
      .addButton(b => b.setCta().setButtonText('立即同步').onClick(() => void this.plugin.runCycle()));
    new Setting(containerEl)
      .setName('仅落盘（不请求 API）')
      .setDesc('把已拉取到本地的划线重新写入 Vault，适合改了勾选/根目录之后用')
      .addButton(b => b.setButtonText('仅落盘').onClick(() => void this.plugin.runSyncOnly()));
  }
}
