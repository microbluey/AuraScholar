export function isImeComposing(event: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  return Boolean(event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229);
}
