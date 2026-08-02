import { Graph } from "@phosphor-icons/react";

export type AppNavIconName =
  | "canvas"
  | "evidence"
  | "library"
  | "profile"
  | "project"
  | "radar"
  | "search"
  | "settings"
  | "snippet";

export interface AppNavItem {
  description: string;
  icon: AppNavIconName;
  label: string;
  to: string;
}

// 阅读器从文献库或研究项目进入；/graph 仅保留给深链。
export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  {
    description: "导入、整理、阅读和引用你的论文库。",
    icon: "library",
    label: "文献库",
    to: "/library",
  },
  {
    description: "围绕课题组织来源、阅读进展、白板与写作材料。",
    icon: "project",
    label: "研究项目",
    to: "/projects",
  },
  {
    description: "集中校验、归档和回溯研读过程中捕获的学术证据。",
    icon: "evidence",
    label: "证据收件箱",
    to: "/evidence",
  },
  {
    description: "检索开放学术来源并把结果沉淀到文献库。",
    icon: "search",
    label: "学术检索",
    to: "/discovery",
  },
  {
    description: "在无限画布中关联文献、摘录、想法与 AI 合成。",
    icon: "canvas",
    label: "空间白板",
    to: "/canvas",
  },
  {
    description: "整理摘录、批注和可复制的写作素材。",
    icon: "snippet",
    label: "写作素材",
    to: "/snippets",
  },
  {
    description: "订阅检索任务，持续追踪新论文。",
    icon: "radar",
    label: "检索哨兵",
    to: "/sentinel",
  },
  {
    description: "编辑个人学术主页并导出发布内容。",
    icon: "profile",
    label: "学术主页",
    to: "/homepage",
  },
  {
    description: "配置 AI、翻译、同步、备份和外观。",
    icon: "settings",
    label: "设置",
    to: "/settings",
  },
];

export function AppNavIcon({ name }: { name: AppNavIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "app-nav-item__icon",
  };

  switch (name) {
    case "library":
      return (
        <svg {...common}>
          <path d="M5 4.5h4.5A2.5 2.5 0 0 1 12 7v12a2.5 2.5 0 0 0-2.5-2.5H5z" />
          <path d="M19 4.5h-4.5A2.5 2.5 0 0 0 12 7v12a2.5 2.5 0 0 1 2.5-2.5H19z" />
        </svg>
      );
    case "project":
      return (
        <svg {...common}>
          <path d="M4 9.5h16v8.8a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3V6.7A1.7 1.7 0 0 1 5.7 5h3.8l1.8 2H18a2 2 0 0 1 2 2" />
          <path d="M8 13h8" />
          <path d="M8 16.5h5" />
        </svg>
      );
    case "evidence":
      return (
        <svg {...common}>
          <path d="M5 4.5h10l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z" />
          <path d="M14.5 4.5V9H19" />
          <path d="M8.5 12.5h7" />
          <path d="M8.5 16h4.5" />
          <path d="m7.5 8 1.2 1.2L11 6.9" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
          <path d="M8.5 11h5" />
        </svg>
      );
    case "canvas":
      return <Graph size={18} weight="regular" aria-hidden className="app-nav-item__icon" />;
    case "snippet":
      return (
        <svg {...common}>
          <path d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
          <path d="M13 4v5h5" />
          <path d="M9 13h6" />
          <path d="M9 16.5h4" />
        </svg>
      );
    case "radar":
      return (
        <svg {...common}>
          <path d="M12 19a7 7 0 1 0-7-7" />
          <path d="M12 15a3 3 0 1 0-3-3" />
          <path d="M12 12 18 6" />
          <path d="M4 20h16" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <path d="M8 4h8a2 2 0 0 1 2 2v14H6V6a2 2 0 0 1 2-2z" />
          <path d="M9 9h6" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          <path d="M19 12a7 7 0 0 0-.1-1.1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.9-1.1L14.3 3h-4.6l-.3 2.9A7 7 0 0 0 7.5 7l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .7.1 1.1l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.9 1.1l.3 2.9h4.6l.3-2.9a7 7 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.5c.1-.4.1-.7.1-1.1z" />
        </svg>
      );
  }
}
