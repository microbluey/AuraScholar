interface LibraryActionIconButtonProps {
  action?: string;
  icon: "menu" | "refresh" | "tag";
  label: string;
  onClick?: () => void;
}

export function LibraryActionIconButton({
  action,
  icon,
  label,
  onClick,
}: LibraryActionIconButtonProps) {
  return (
    <button
      aria-label={label}
      className="library-icon-button"
      data-library-action={action}
      onClick={onClick}
      title={label}
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
        width="16"
      >
        {icon === "refresh" ? (
          <>
            <path d="M20 12a8 8 0 0 1-13.6 5.7" />
            <path d="M4 12A8 8 0 0 1 17.6 6.3" />
            <path d="M17.6 3.5v2.8h-2.8" />
            <path d="M6.4 20.5v-2.8h2.8" />
          </>
        ) : icon === "tag" ? (
          <>
            <path d="M3 11.5V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.5 6.5a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.6-1.4z" />
            <circle cx="7.5" cy="7.5" r="1.3" />
          </>
        ) : (
          <>
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </>
        )}
      </svg>
    </button>
  );
}
