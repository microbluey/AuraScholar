export const RESULT_PREFIX = "AURASCHOLAR_SMOKE_RESULT ";

export function parseResultLine(text) {
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(RESULT_PREFIX);
    if (index === -1) continue;
    return JSON.parse(line.slice(index + RESULT_PREFIX.length));
  }
  return null;
}

export function createResultLineParser(onResult) {
  let buffered = "";

  const parseCompleteLine = (line) => {
    const parsed = parseResultLine(line);
    if (parsed) onResult(parsed);
  };

  return {
    flush() {
      if (!buffered) return;
      parseCompleteLine(buffered);
      buffered = "";
    },
    push(text) {
      buffered += text;
      let newlineIndex = buffered.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffered.slice(0, newlineIndex).replace(/\r$/, "");
        buffered = buffered.slice(newlineIndex + 1);
        parseCompleteLine(line);
        newlineIndex = buffered.indexOf("\n");
      }
    },
  };
}
