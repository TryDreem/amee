// Exact rule per contract §8 / INVARIANTS S7: strip . , ! ? ; : — – and ellipsis runs (removed
// as a unit, not kept as a pause); apostrophes and hyphens between two letters are preserved.
// Applied to *displayed* text only — Word.text itself is never mutated (S1's same rule).
const SENTENCE_PUNCTUATION = /[.,!?;:—–]/g;
const ELLIPSIS_RUN = /\.{2,}/g;
const EDGE_APOSTROPHE = /(?<!\p{L})'|'(?!\p{L})/gu;
const EDGE_HYPHEN = /(?<!\p{L})-|-(?!\p{L})/gu;

export function stripPunctuation(text: string): string {
  return text
    .replace(ELLIPSIS_RUN, "")
    .replace(SENTENCE_PUNCTUATION, "")
    .replace(EDGE_APOSTROPHE, "")
    .replace(EDGE_HYPHEN, "");
}
