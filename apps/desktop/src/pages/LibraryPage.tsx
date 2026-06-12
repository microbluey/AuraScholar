import { Badge, Button, Card, Input } from "@aurascholar/ui";

export function LibraryPage() {
  return (
    <div>
      <h1 className="app-page-title">文献库</h1>
      <p className="app-page-subtitle">通过 DOI、论文链接或本地 PDF 添加文献</p>
      <Card style={{ maxWidth: 640 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Input placeholder="粘贴 DOI / arXiv ID / 论文链接…" />
          <Button>添加</Button>
          <Button variant="secondary">上传 PDF</Button>
        </div>
        <p className="au-text-muted" style={{ fontSize: 13, marginBottom: 0 }}>
          示例:10.1038/s41586-021-03819-2 · arXiv:1706.03762 ·
          https://doi.org/10.1145/3442188
        </p>
      </Card>
      <div style={{ marginTop: 24 }}>
        <Badge variant="neutral">P1 开发中 — 入库管线、列表、阅读器</Badge>
      </div>
    </div>
  );
}
