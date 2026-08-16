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

  // A single word wider than the budget can't be helped — wrapping only happens *between* words
  // (L2), never inside one. It still has to be reported: it is the one overflow case a line break
  // cannot fix, and silently placing it would push the caption outside the safe area.
  let wordTooWide = false;

  for (const word of words) {
    const current = lines[lines.length - 1];
    if (!current) {
      continue;
    }
    if (current.length === 0) {
      current.push(word.text);
      if (measureWidth(word.text) > maxWidth) {
        wordTooWide = true;
      }
      continue;
    }
    const candidate = [...current, word.text].join(" ");
    if (measureWidth(candidate) <= maxWidth) {
      current.push(word.text);
    } else {
      lines.push([word.text]);
      if (measureWidth(word.text) > maxWidth) {
        wordTooWide = true;
      }
    }
  }

  return {
    lines: lines.slice(0, MAX_LINES),
    overflow: lines.length > MAX_LINES || wordTooWide,
  };
}
