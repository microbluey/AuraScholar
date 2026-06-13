# Word 写作集成可行性调研（Cite-While-You-Write 等价物）

> 状态:调研 / 提案。本轮**不实现**，仅给出方案与里程碑供决策。
> 关联代码:引文格式化与导出已在 `packages/cite` 落地(BibTeX / RIS / CSL-JSON + 7 种样式)。
> 关联调研:EndNote CWYW、Zotero word processor 集成、Office.js OOXML。

## 1. 背景与目标

用户的核心写作工作流是「在 Word 里写论文,用 EndNote 插件把文献库里的文献按指定格式
(APA / GB-T 7714 / IEEE…)插入正文并自动生成参考文献表」。这就是 EndNote 的
**Cite While You Write (CWYW)**:光标定位 → Insert Citation → 搜库选文献 →
自动插入文内引文 + 文末书目 → 下拉切换样式时全文重排。

目标是评估 AuraScholar(Tauri 桌面应用)提供同等能力的可行性。结论先行:
**完整的 CWYW 是重投入**,建议分阶段;P2 已交付的引文导出 + 剪贴板复制已能覆盖很大一部分
真实需求(尤其 LaTeX / Markdown / 手动粘贴用户),Word 深度集成作为后续里程碑。

## 2. 竞品机制(调研结论)

### EndNote CWYW
- Word 加载项(Windows 随安装捆绑;EndNote Basic 从网页端下载)。
- 文内引文与书目以 **Word 域(field codes)** 形式嵌入,域里存的是引文的结构化数据;
  切换 Style 下拉时,插件重新格式化所有域。
- Word Online 版限制更多:必须通过 EndNote 侧边栏插入,临时引文不能手动编辑。

### Zotero word processor 集成(开源参照)
- **LibreOffice**:插件通过 localhost **23116 端口**与 Zotero 主程序通信,
  自定义二进制帧(32-bit 事务 ID + big-endian 长度 + JSON 负载)。引文存为
  **ReferenceMark / Bookmark** 字段,字段有 `fieldID` / `fieldCode`(隐藏的持久化引文数据)/
  `noteIndex`。命令如 `addEditCitation`、`addEditBibliography`、`refresh`、`setDocPrefs`。
- **Word (Win/Mac)**:不走 23116,而是**原生进程内**:Windows 用 COM、macOS 用 AppleEvents。
- 文档可转成「传输格式」,引文变成指向 zotero.org 的超链接,带 `ZOTERO_TRANSFER_DOCUMENT` 标记,
  便于跨机重新关联。

**要点提炼**:CWYW 的不可替代性来自两件事 ——(a)引文数据**持久化嵌入文档**(域/内容控件),
(b)样式切换时**全文重格式化**。引文格式化本身我们已经有了(`packages/cite`)。

## 3. AuraScholar 候选方案对比

| 维度 | A. Office.js 加载项 + 本地 HTTP 桥(推荐) | B. 原生插件(COM/AppleEvents) | C. 仅导出 + 手动粘贴(已交付) |
|---|---|---|---|
| 跨平台 | ✅ Win/Mac/Word Online/iPad | ❌ 每平台各写一套 | ✅ 全平台 |
| 持久化域引文 | ✅ Content Control | ✅ Field Code | ❌ 纯文本,不可重排 |
| 样式切换全文重排 | ✅(扫描 Content Control 重格式化) | ✅ | ❌ |
| 实现成本 | 中(独立加载项 + 桥接 + 上架) | 高(双原生栈 + 签名分发) | **已完成** |
| 与 Tauri 通信 | localhost HTTP / WebSocket 桥 | 进程内,无需桥 | 系统剪贴板 |
| 分发 | Office 加载项(sideload / AppSource) | 安装包内含原生组件 | 无 |
| 风险 | 本地端口安全;Word Online 限制 | 维护负担最大 | 功能弱(无重排) |

## 4. 推荐路径:Office.js 加载项 + 本地引文桥

```
┌────────────────────┐     localhost HTTP (loopback, token 鉴权)    ┌──────────────────────┐
│  Word + Office.js   │  ── GET /library/search?q=… ──────────────▶ │  AuraScholar (Tauri)  │
│  加载项(任务窗格)  │  ◀─ 候选文献 JSON ───────────────────────── │  ├ 引文桥 HTTP server │
│                     │  ── POST /cite/format {ids, styleId} ─────▶ │  ├ packages/cite      │
│  在光标处插入        │  ◀─ {inText, bibliography} ──────────────── │  └ SQLite 文献库      │
│  Content Control     │                                             └──────────────────────┘
│  (存 ids+styleId)    │
└────────────────────┘
        │  样式切换:遍历所有 Content Control → 重新 POST /cite/format → 替换文本
        ▼
   文末参考文献表(单独 Content Control)
```

- **引文数据载体**:Word **Content Control**(`Word.ContentControl`),tag 里存
  `{citationId, workIds, styleId}` 的 JSON。等价于 Zotero 的 field code。
- **格式化来源**:复用 `packages/cite` 的 `formatCitation` / `formatBibliography`。
  Tauri 侧暴露一个**仅监听 127.0.0.1 的 HTTP 服务**(Rust `tauri` + `axum`/`tiny_http`),
  加载项用一次性 token 鉴权(防止其它本地进程读库)。
- **样式切换**:加载项遍历文档内所有 citation Content Control,带 `styleId` 重新请求格式化,
  替换可见文本 + 重建书目 —— 即全文重排。
- **Word Online**:同一 Office.js 代码可跑,但本地桥在 Online 下不可达(无 localhost)。
  Online 场景退化为:加载项直接调用 AuraScholar 云端 API(若启用官方云)或仅支持桌面 Word。

### citeproc 升级位
当前 `packages/cite` 是自研、无依赖、覆盖 7 种样式的格式化器,已能满足常见需求。
若需对接「数千种期刊 CSL 样式」,在 `formatBibliography` 背后接入 **citeproc-js**
(需打包对应 `.csl` 样式文件 + locale + `sys` 回调)。接口已为此预留,call site 不变。

## 5. 最小可行里程碑(MVP)

1. **M1 — 引文桥**:Tauri 暴露 loopback HTTP(`/library/search`、`/cite/format`),token 鉴权。复用 `packages/cite`。
2. **M2 — 加载项骨架**:Office.js 任务窗格(搜索框 + 结果列表 + 「插入引文」按钮),sideload 调试。
3. **M3 — 插入与书目**:在光标插入 citation Content Control;维护文末书目 Content Control。
4. **M4 — 样式切换重排**:样式下拉 → 遍历 Content Control 重格式化。
5. **M5 — 分发**:加载项打包(manifest)、签名;桌面 Word 优先,Word Online 视云服务而定。

## 6. 风险与缓解

- **本地端口安全**:桥仅绑定 127.0.0.1;启动时生成随机 token,加载项首次连接时由用户在
  AuraScholar 内确认配对(类似 Zotero connector 的握手)。不监听 0.0.0.0。
- **Word Online 限制**:临时引文不能手动编辑、必须经侧边栏 —— 与 EndNote 在线版同样的限制,
  文档需如实告知用户;桌面 Word 体验完整。
- **Content Control 兼容**:旧版 Word(<2016)对 Office.js 支持有限;明确支持 Word 2016+。
- **维护面**:Office.js 单一代码库即可覆盖三端,显著优于原生 COM/AppleEvents 双栈。

## 7. 当前已交付的非 Word 路径(P2)

在 Word 深度集成落地前,以下能力已可用,覆盖大量真实写作场景:
- **复制参考文献**:库内多选 → 选样式(APA / GB-T 7714 / IEEE / Vancouver / MLA / Nature / Chicago)→
  复制到剪贴板,直接粘进 Word / WPS / 任意编辑器。
- **导出 .bib / .ris / CSL-JSON**:服务 LaTeX(`\cite` + BibTeX)、pandoc、以及回流到 Zotero/EndNote。

> 建议:先观察「复制 + 导出」对用户的覆盖度,再决定是否投入 M1–M5 的 Word 深度集成。
