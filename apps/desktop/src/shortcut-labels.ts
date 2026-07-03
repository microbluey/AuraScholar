export function isApplePlatform(platform = globalThis.navigator?.platform ?? ""): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function shortcutLabel(key: string, options: { compactApple?: boolean } = {}): string {
  const normalizedKey = key.trim().toUpperCase();
  if (isApplePlatform()) {
    return options.compactApple ? `⌘${normalizedKey}` : `⌘ ${normalizedKey}`;
  }
  return `Ctrl ${normalizedKey}`;
}
