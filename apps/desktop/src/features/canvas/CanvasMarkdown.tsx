import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function CanvasMarkdown({
  className = "",
  emptyLabel,
  markdown,
}: {
  className?: string;
  emptyLabel?: string;
  markdown: string;
}) {
  if (!markdown && emptyLabel) {
    return <p className={`canvas-markdown-empty ${className}`.trim()}>{emptyLabel}</p>;
  }

  return (
    <div className={`canvas-markdown ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
