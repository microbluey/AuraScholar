export function isApplePlatform(platform = globalThis.navigator?.platform ?? ""): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function isPlatformShortcut(
  event: {
    altKey?: boolean;
    ctrlKey?: boolean;
    key?: string;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
  key: string,
  platform = globalThis.navigator?.platform ?? "",
): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.key?.toLowerCase() !== key.trim().toLowerCase()) return false;
  return isApplePlatform(platform)
    ? Boolean(event.metaKey && !event.ctrlKey)
    : Boolean(event.ctrlKey && !event.metaKey);
}

export function shortcutLabel(key: string, options: { compactApple?: boolean } = {}): string {
  const normalizedKey = key.trim().toUpperCase();
  if (isApplePlatform()) {
    return options.compactApple ? `⌘${normalizedKey}` : `⌘ ${normalizedKey}`;
  }
  return `Ctrl ${normalizedKey}`;
}
