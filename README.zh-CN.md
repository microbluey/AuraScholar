# AuraScholar

> 面向青年科研人员的开源科研助手 — 查找 · 管理 · 阅读 · 关联 · 写作引用,全流程一站式

[![CI](https://github.com/microbluey/AuraScholar/actions/workflows/ci.yml/badge.svg)](https://github.com/microbluey/AuraScholar/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

[English](./README.md) | **简体中文**

AuraScholar 帮助硕士生、博士生、博士后与青年教师把日常科研串成一条顺滑的链路:从发现文献,到管理与阅读,再到在空间白板中重组证据与想法,最后在写作时插入引文。

![文献库](./assets/screenshots/library.png)

> [!NOTE]
> **项目状态:早期开发中(alpha)。** 核心链路可用,但仍在快速迭代,可能有粗糙之处和不兼容变更;暂不建议把它作为你唯一的文献库管理工具。

## 功能

### 📚 文献工作台

- **多途径入库**:DOI / arXiv ID / 论文链接 / 本地 PDF 一键入库,自动抓取元数据并尝试下载开放获取(OA)全文;本地 PDF 会从正文识别 DOI 回填完整元数据。
- **批量迁移**:从 Zotero / EndNote 导入 BibTeX / RIS / CSL-JSON,按 DOI 与「标题+年份+作者」指纹自动去重。
- **元数据来源**:聚合 Crossref、OpenAlex、Semantic Scholar、Unpaywall、arXiv 五个开放数据源。

### 🔍 学术检索

- **开放源聚合检索**:OpenAlex / Crossref / Semantic Scholar / arXiv 原生聚合,结果去重合并、标记是否已在库,一键入库(含 OA PDF 获取)。
- **内置学术浏览器**:在应用内多标签打开 Google Scholar、Web of Science、Scopus、PubMed、CNKI、IEEE Xplore、ScienceDirect、SpringerLink、Wiley、ACM、JSTOR、ResearchGate、bioRxiv、DBLP、百度学术、万方、维普等常用站点(可增删自定义站点)。每个站点登录态独立隔离并持久保存。
  - **下载即入库**:在站内(含机构订阅)下载的 PDF / 导出的引用文件被自动捕获并入库。
  - **Arc 式标签归档**:长时间不活跃的标签自动休眠释放内存,点击秒级恢复到原页。
  - **网络灵活**:每个站点可单独走代理(校园网 VPN 与梯子互不干扰);支持图书馆 EZproxy 前缀,一键以学校订阅身份打开期刊全文。

![学术检索](./assets/screenshots/discovery.png)

### 📖 PDF 阅读器

- 高亮、下划线、删除线、便签/评论,多级文本锚定。
- 划词 / 整页 / 全文翻译(大模型 / DeepL / 百度),结果缓存避免重复消耗。
- 侧栏三视图:批注 · AI 重点 · 引文脉络。
- **引文脉络图**:以时间轴布局呈现引用关系,替代难读的传统引用树。

### 🧠 空间白板与 AI 合成

- **多个独立白板**:可将不同研究项目分开到独立工作区;画布顶部切换器支持新建和切换,每个白板的 `...` 菜单可重命名或安全删除。删除前会显示白板名称与卡片数并要求二次确认,系统始终保留至少一个白板,且绝不删除文献库论文与 PDF 源文件。打开 `/canvas` 会恢复最近使用的白板,并进入 RESTful 路由 `/canvas/:workspaceId`;旧版默认白板数据会作为第一个工作区保留。
- **无限研究画布**:把完整文献、PDF 摘录、研究想法与 AI 合成结果放入同一张可缩放、可平移的点阵画布;支持框选、多选、拖动、关系连线、可折叠分组与 MiniMap。
- **五类内置节点**:无需先做摘录即可从文献库或阅读器加入整篇文献;当前支持文献、摘录、AI 合成、Markdown/LaTeX 研究想法和逻辑分组节点。
- **白板 + 阅读器同屏分屏**:文献卡或摘录卡可直接在白板右侧的可调阅读器中打开,避免切走白板后丢失研究上下文。桌面端默认约为白板 60%、阅读器 40%;摘录会定位到对应附件、批注与页码,同时保留进入完整阅读器的入口。
- **高亮拖入白板**:保存 PDF 高亮后,可把摘录条拖到白板,也可点击「加入当前白板」。系统会创建 `ExcerptNode`,并从来源 `PaperNode` 自动建立 `derived-from` 连线;工作区、文献、来源节点及请求身份都会被校验,避免旧阅读请求跨白板写入。
- **快捷语义连线与来源回溯**:在“选择”模式下悬停或聚焦卡片,即可显示上、下、左、右四个磁力连接点;从一张卡片拖到另一张后,在原地 Pills 中选择**引用**、**支持**、**反驳**或**扩展**,也可按数字键 `1`–`4`,`Escape` 取消。同一来源 → 目标方向只保留一条关系,反向目标 → 来源仍可独立建立;自定义关系可继续在检查器中编辑,摘录卡也会保留来源锚点。
- **有来源边界的 AI 合成**:选择 2–10 张文献或摘录节点,生成方法论对比、分歧分析、研究空白或简明综述。文献节点只提供题录与可用摘要,而非 PDF 全文;摘录节点提供所选原文。结果保留来源节点与派生关系,实际生成需要配置 AI 服务。
- **文献库与阅读器加入**:只有一个白板时,文献或摘录会直接加入;存在多个白板时,轻量选择器默认选中当前活跃白板,也可就地新建目标白板。
- **本地持久化**:桌面端将白板保存到 SQLite,整库 JSON 备份包含白板数据;空间白板暂未纳入 WebDAV 行级同步。浏览器预览有意不读取本机 PDF,同屏阅读的真实 PDF 工作流需在桌面应用中使用。详见[空间白板产品与架构说明](./docs/SPATIAL_CANVAS_PRD.md)。

![空间研究白板](./assets/screenshots/canvas.jpg)

### ✍️ 写作支持

- **写作素材**:阅读时随手摘录,按论文归类,可加备注、跳回原文。
- **引文格式化**:导出 APA 7th、GB/T 7714-2015、IEEE、Vancouver、MLA 9th、Nature、Chicago 等多种样式,以及 BibTeX / RIS / CSL-JSON。
- **Word 引用桥**(规划中):应用内置本地服务,为未来的 Word 加载项预留接口,实现类 Zotero 的"边写边引"。

### 📡 检索哨兵

- 自动监控论文从 Accept → Online → 正式出版 → 数据库收录的全过程,状态变化即时通知,并保存证据快照;无 DOI 的论文支持按标题监控,命中后自动升级为 DOI 跟踪,出版后自动入库。

![检索哨兵](./assets/screenshots/sentinel.png)

### 🌐 个人学术主页 / CV

- 自动同步已发表成果,编辑个人资料,选择展示论文,实时预览并导出可分享的主页与简历。

## 设计理念

- **本地优先**:数据存在你自己的设备上(SQLite),可备份到任意位置。
- **全功能免费**:文献记录、批注与检索状态可通过自己的 WebDAV 服务同步,也可使用提供 WebDAV 接口的 NAS 或网盘(混合逻辑时钟 + 逐字段 LWW 冲突解决);空间白板当前通过整库 JSON 备份迁移。AI 使用你自己的模型服务与 API Key(OpenAI 兼容 / Anthropic)。
- **付费买省心**:官方云同步、官方 AI 服务、7×24 云端哨兵与主页托管,作为可选会员服务,供不想折腾的用户使用。
- **双主题**:日间「Dawn」学术极简冷淡风,夜间「Nocturne」极客暗黑科技风。

## 项目结构

```
apps/
  desktop/    # Electron 桌面应用(macOS / Windows / Linux)
  gallery/    # 双主题组件画廊(设计参照)
  web/        # PWA(SQLite WASM + OPFS,规划中)
  mobile/     # 移动端(规划中)
packages/
  tokens/     # 双主题设计令牌
  ui/         # 组件库(Radix + Tailwind)
  db/         # Drizzle ORM schema 与迁移
  platform/   # 平台能力抽象(HTTP / FS / 通知 / 钥匙串 / 调度)
  connectors/ # Crossref / OpenAlex / Semantic Scholar / Unpaywall / arXiv 客户端
  core/       # 领域逻辑:入库管线、聚合检索、哨兵状态机、空间白板模型、引文图谱
  reader/     # PDF 阅读器与批注引擎(多级锚定)
  translate/  # 翻译抽象与实现(大模型 / DeepL / 百度)
  cite/       # CSL 引文格式化、BibTeX/RIS 导入导出
  ai/         # AIProvider 抽象、BYOK 实现与空间白板 AI 合成
  sync/       # 同步引擎(HLC + 逐字段 LWW)与 JSON 备份导入重映射
  homepage/   # 主页模板与 CV 生成
```

桌面壳采用 Electron。共享且平台无关的领域逻辑位于 `packages/`,Electron 专属编排与 UI 位于 `apps/desktop/`。Electron 主进程提供 SQLite / 无 CORS HTTP / 文件系统 / 通知 / 内置浏览器,经 preload 的 `window.aura` 桥接给渲染进程。架构详见 [apps/desktop/README.md](./apps/desktop/README.md)。

## 开发

```bash
pnpm install
pnpm build        # 构建所有包
pnpm test         # 运行测试

# 启动桌面应用(Electron)
pnpm --filter @aurascholar/desktop rebuild:electron   # 首次/跑过测试后:把原生模块切到 Electron ABI
pnpm --filter @aurascholar/desktop dev
```

桌面端是纯 JS/TS 的 Electron 应用,无需 Rust 工具链。唯一的原生依赖
`better-sqlite3` 在 Node(测试)与 Electron(应用)下需要不同的二进制 ABI,
不能共存:`pnpm install` 后默认是 Node ABI(`pnpm test` 可直接跑),跑应用前用
`rebuild:electron` 切换;若之后要再跑测试,执行 `pnpm rebuild better-sqlite3`
切回。打包(`pnpm --filter @aurascholar/desktop package`)会自动为 Electron
重编。详见 [apps/desktop/README.md](./apps/desktop/README.md)。

## 参与贡献

欢迎 Issue 与 PR,请见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[AGPL-3.0-only](./LICENSE)
