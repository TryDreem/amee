// Pure line-wrap logic (arch §8.1-§8.3, INVARIANTS L1-L4): wrap only between words, max 2
// visual lines, and a 3rd-line requirement is an overflow flag, never auto-shrink/split/truncate.
// Takes a measure function so it's testable without a real canvas/DOM.
export interface WrapResult {
  lines: string[][];
  overflow: boolean;
}

const MAX_LINES = 2;

export function wrapWords(
  words: { text: string }[],
  measureWidth: (text: string) => number,
  maxWidth: number
): WrapResult {
  const lines: string[][] = [[]];

  for (const word of words) {
    const current = lines[lines.length - 1];
    if (!current) {
      continue;
    }
    if (current.length === 0) {
      current.push(word.text);
      continue;
    }
    const candidate = [...current, word.text].join(" ");
    if (measureWidth(candidate) <= maxWidth) {
      current.push(word.text);
    } else {
      lines.push([word.text]);
    }
  }

  return {
    lines: lines.slice(0, MAX_LINES),
    overflow: lines.length > MAX_LINES,
  };
}
