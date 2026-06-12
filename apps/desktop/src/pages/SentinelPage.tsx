import { Badge } from "@aurascholar/ui";

export function SentinelPage() {
  return (
    <div>
      <h1 className="app-page-title">检索哨兵</h1>
      <p className="app-page-subtitle">
        自动监控论文 Accept → Online → 正式出版 → 数据库收录的全过程
      </p>
      <Badge variant="neutral">P3 规划中 — 状态机、轮询与通知</Badge>
    </div>
  );
}
