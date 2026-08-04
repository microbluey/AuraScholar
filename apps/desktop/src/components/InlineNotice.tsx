import type { ReactNode } from "react";
import { inferNoticeTone, type InlineNoticeTone } from "./inline-notice-model";

export { inferNoticeTone, type InlineNoticeTone } from "./inline-notice-model";

interface InlineNoticeProps {
  children?: ReactNode;
  className?: string;
  message?: string | null;
  onDismiss?: () => void;
  tone?: InlineNoticeTone;
}

export function InlineNotice({ children, className, message, onDismiss, tone }: InlineNoticeProps) {
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
      <span className="inline-notice__content">{content}</span>
      {onDismiss && (
        <button
          type="button"
          className="inline-notice__dismiss"
          aria-label="关闭通知"
          title="关闭通知"
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </p>
  );
}
