import type { ReactNode } from "react";

export type InlineNoticeTone = "neutral" | "success" | "warning" | "danger" | "busy";

interface InlineNoticeProps {
  children?: ReactNode;
  className?: string;
  message?: string | null;
  tone?: InlineNoticeTone;
}

const BUSY_RE = /正在|处理中|读取|加载|下载|导入中|检查中|识别|生成/;
const DANGER_RE = /失败|错误|异常|无法|无效|不正确|没有解析|无法识别|未能/;
const PREVIEW_RE = /浏览器预览|预览模式|当前环境无法/;
const WARNING_RE = /请先|请输入|必须|暂无|没有可|预览模式|看起来不标准|当前没有|不会写入|暂时无法/;
const SUCCESS_RE = /已|成功|完成|发现\s*\d+|新增\s*\d+|复制|导出|入库|保存|恢复|删除|标记/;

export function inferNoticeTone(message: string): InlineNoticeTone {
  if (PREVIEW_RE.test(message)) return "warning";
  if (DANGER_RE.test(message)) return "danger";
  if (BUSY_RE.test(message)) return "busy";
  if (WARNING_RE.test(message)) return "warning";
  if (SUCCESS_RE.test(message)) return "success";
  return "neutral";
}

export function InlineNotice({ children, className, message, tone }: InlineNoticeProps) {
  const content = children ?? message;
  if (!content) return null;

  const text = typeof content === "string" ? content : typeof message === "string" ? message : "";
  const resolvedTone = tone ?? (text ? inferNoticeTone(text) : "neutral");
  const isDanger = resolvedTone === "danger";
  const classes = ["inline-notice", `inline-notice--${resolvedTone}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <p
      className={classes}
      role={isDanger ? "alert" : "status"}
      aria-live={isDanger ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={resolvedTone === "busy" ? "true" : undefined}
    >
      {content}
    </p>
  );
}
