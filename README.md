# AuraScholar

> 面向青年科研人员的开源科研助手 — 文献管理 · 检索哨兵 · 学术主页

AuraScholar 帮助硕士生、博士生、博士后与青年教师解决三件日常麻烦事:

1. **一站式文献工作台** — 通过 DOI / 论文链接 / 本地 PDF 一键入库,自动抓取元数据与开放获取全文;也支持从 Zotero / EndNote(BibTeX / RIS / CSL-JSON)批量导入。内置精心打磨的 PDF 阅读器,支持高亮、下划线、便签、评论,以及划词 / 整页 / 全文翻译(大模型 / DeepL / 百度)。AI 闪卡提炼每篇论文的核心贡献;时间轴引文脉络图替代难懂的传统引用树。阅读时随手摘录写作素材,写作时一键导出多种格式引文(APA / GB-T 7714 / IEEE 等)。
2. **检索哨兵** — 自动监控论文从 Accept → Online → 正式出版 → 数据库收录的全过程,状态变化即时通知,并保存证据快照,告别反复去图书馆查证的烦恼。
3. **个人学术主页 / CV** — 自动同步已发表成果,一键生成精美可分享的个人主页与 PDF 简历。

## 设计理念

- **本地优先**:数据存储在你自己的设备上(SQLite),支持备份到任意位置。
- **全功能免费**:同步可以走你自己的 WebDAV / NAS / 网盘文件夹;AI 可以配置你自己的模型服务地址与 API Key(OpenAI 兼容 / Anthropic)。
- **付费买省心**:官方云同步、官方 AI 服务、7×24 云端哨兵与主页托管将作为可选的会员服务,供不想折腾的用户使用。
- **双主题**:日间「Dawn」学术极简优雅冷淡风,夜间「Nocturne」极客暗黑科技风。

## 项目结构

```
apps/
  desktop/    # Tauri 2 桌面应用(macOS / Windows / Linux)
  gallery/    # 双主题组件画廊(设计参照)
  web/        # PWA(SQLite WASM + OPFS,规划中)
  mobile/     # Tauri 2 Mobile(规划中)
packages/
  tokens/     # 双主题设计令牌
  ui/         # 组件库(Radix + Tailwind)
  db/         # Drizzle ORM schema 与迁移
  platform/   # 平台能力抽象(HTTP / FS / 通知 / 钥匙串 / 调度)
  connectors/ # Crossref / OpenAlex / Semantic Scholar / Unpaywall / arXiv 客户端
  core/       # 领域逻辑:入库管线、哨兵状态机、闪卡、图谱
  reader/     # PDF 阅读器与批注引擎(多级锚定)
  translate/  # 翻译抽象与实现(大模型 / DeepL / 百度)
  cite/       # CSL 引文格式化、BibTeX/RIS 导入导出
  ai/         # AIProvider 抽象与实现(OpenAI 兼容 / Anthropic)
  sync/       # SyncProvider 抽象与同步引擎
  homepage/   # 主页模板与 CV 生成
```

## 开发

```bash
pnpm install
pnpm build        # 构建所有包
pnpm dev          # 开发模式
pnpm test         # 运行测试
```

桌面端开发需要 [Rust 工具链](https://www.rust-lang.org/tools/install) 与 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)。

## License

[AGPL-3.0-only](./LICENSE)
