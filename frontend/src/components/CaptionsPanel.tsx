import { useEffect, useRef, useState } from "react";

import type { PresetBase, Segment } from "../api/client";
import { activeWordIndexInSegment, findActiveSegmentIndex, highlightColorFor } from "../lib/activeSegment";
import { colorWithAlpha, parseColorString } from "../lib/color";
import { stripPunctuation } from "../lib/stripPunctuation";
import type { Strings } from "../i18n";
import { resolveTheme, UI_MODES, type ModeColors, type Prefs } from "../theme";

export type CaptionPopup =
  | { type: "word"; segmentId: string; wordId: string }
  | { type: "scene"; segmentId: string }
  | null;

interface CaptionsPanelProps {
  prefs: Prefs;
  strings: Strings;
  segments: Segment[];
  currentTime: number;
  resolvedStyle: PresetBase | null;
  perPhraseStyle: boolean;
  editingSegmentId: string | null;
  popup: CaptionPopup;
  confirmDeleteSegmentId: string | null;
  pendingWordId: string | null;
  onSeek: (t: number) => void;
  onEditSegmentStyle: (segmentId: string) => void;
  onWordClick: (segmentId: string, wordId: string) => void;
  onRangeClick: (segmentId: string) => void;
  onClosePopup: () => void;
  onAddWord: (segmentId: string, wordId: string, side: "left" | "right") => void;
  onSplitSegment: (segmentId: string, wordId: string) => void;
  onRemoveWord: (segmentId: string, wordId: string) => void;
  onDeleteClick: (segmentId: string) => void;
  onConfirmDelete: (segmentId: string) => void;
  onCancelDelete: () => void;
  onCommitWordText: (segmentId: string, wordId: string, text: string) => void;
  onCommitWordStart: (segmentId: string, wordId: string, raw: string) => void;
  onCommitWordEnd: (segmentId: string, wordId: string, raw: string) => void;
  onCommitSceneStart: (segmentId: string, raw: string) => void;
  onCommitSceneEnd: (segmentId: string, raw: string) => void;
}

function segmentRange(segment: Segment): { start: number; end: number; label: string } {
  const first = segment.words[0];
  const last = segment.words.at(-1);
  const start = first?.start ?? 0;
  const end = last?.end ?? 0;
  return { start, end, label: `${start.toFixed(2)} – ${end.toFixed(2)}s` };
}

const POPUP_WIDTH = 230;
const WORD_POPUP_HEIGHT = 230;
const SCENE_POPUP_HEIGHT = 130;

export default function CaptionsPanel({
  prefs,
  strings: L,
  segments,
  currentTime,
  resolvedStyle,
  perPhraseStyle,
  editingSegmentId,
  popup,
  confirmDeleteSegmentId,
  pendingWordId,
  onSeek,
  onEditSegmentStyle,
  onWordClick,
  onRangeClick,
  onClosePopup,
  onAddWord,
  onSplitSegment,
  onRemoveWord,
  onDeleteClick,
  onConfirmDelete,
  onCancelDelete,
  onCommitWordText,
  onCommitWordStart,
  onCommitWordEnd,
  onCommitSceneStart,
  onCommitSceneEnd,
}: CaptionsPanelProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);

  const containerRef = useRef<HTMLDivElement>(null);
  // Defaults to the top-left corner (clamped into view either way) rather than null, so the
  // popup still renders correctly if `popup` is ever driven from outside a fresh click inside
  // this component (e.g. restored from state) instead of only right after computeAnchoredPosition runs.
  const [popupPos, setPopupPos] = useState<{ x: number; y: number }>({ x: 8, y: 8 });

  // Draft (uncommitted) values for whichever text/start/end field is currently being edited --
  // committed on blur/Enter, not on every keystroke (deliberately not the design's own
  // per-keystroke-live-commit for text, which has no empty/limit safety net for existing
  // words -- this reuses the same safe commitWordText path pending words already went through).
  const [draftText, setDraftText] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");

  const activeSegmentIndex = findActiveSegmentIndex(segments, currentTime);

  const popupSegment = popup ? segments.find((s) => s.id === popup.segmentId) : undefined;
  const popupWord =
    popup?.type === "word" && popupSegment ? popupSegment.words.find((w) => w.id === popup.wordId) : undefined;

  // The committed values the popup's fields are seeded from. For a word popup: the word's own
  // start/end/text. For a scene popup: the segment's derived start/end (its first word's start,
  // last word's end -- D5, no stored segment bound). Kept as primitives so the seeding effect
  // below re-runs when a *commit* changes them, but not on every keystroke.
  const seedStart =
    popup?.type === "word" ? popupWord?.start : popupSegment ? segmentRange(popupSegment).start : undefined;
  const seedEnd =
    popup?.type === "word" ? popupWord?.end : popupSegment ? segmentRange(popupSegment).end : undefined;
  const seedText = popupWord?.text;

  // Seed the draft fields from the committed values, and re-seed after each commit (which
  // changes seedStart/seedEnd/seedText) -- this is what snaps a field back to the validated
  // value when an edit was reverted, exactly like the design's own commit-then-reseed. It does
  // NOT fire on keystrokes: typing only updates the local drafts, never the committed values.
  useEffect(() => {
    if (popup?.type === "word" && popupWord) {
      setDraftText(popupWord.text);
      setDraftStart(popupWord.start.toFixed(2));
      setDraftEnd(popupWord.end.toFixed(2));
    } else if (popup?.type === "scene" && popupSegment) {
      const r = segmentRange(popupSegment);
      setDraftStart(r.start.toFixed(2));
      setDraftEnd(r.end.toFixed(2));
    } else if (pendingWordId) {
      setDraftText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup, pendingWordId, seedStart, seedEnd, seedText]);

  // Anchored next to whatever was clicked, matching the design's own word/scene popup
  // placement: to the right when there's room, mirrored to the left otherwise, vertically
  // centered on the target and clamped so it never overflows the list container.
  function computeAnchoredPosition(target: HTMLElement, popupHeight: number): { x: number; y: number } {
    const container = containerRef.current;
    if (!container) {
      return { x: 8, y: 8 };
    }
    const rect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const gap = 12;
    const spaceRight = rect.width - (tRect.right - rect.left);
    const x =
      spaceRight >= POPUP_WIDTH + gap + 8
        ? tRect.right - rect.left + gap
        : Math.max(8, tRect.left - rect.left - POPUP_WIDTH - gap);
    const centerY = tRect.top - rect.top + tRect.height / 2;
    const y = Math.min(Math.max(centerY - popupHeight / 2, 8), Math.max(8, rect.height - popupHeight - 8));
    return { x, y };
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: "10px" }}>
      {segments.map((segment, segIdx) => {
        const isConfirmingDelete = confirmDeleteSegmentId === segment.id;
        const isActiveSegment = segIdx === activeSegmentIndex;
        const isEditingStyle = perPhraseStyle && editingSegmentId === segment.id;
        const color = highlightColorFor(
          resolvedStyle?.highlightColors ?? [],
          segIdx,
          resolvedStyle?.color ?? mode.textMain
        );
        const activeWordIdx = isActiveSegment ? activeWordIndexInSegment(segment, currentTime) : -1;
        const range = segmentRange(segment);

        return (
          <div
            key={segment.id}
            style={{
              padding: "14px 16px",
              borderRadius: "10px",
              border: "1px solid " + (isEditingStyle ? theme.accent : isActiveSegment ? color : mode.cardBorder),
              background: isActiveSegment ? tint(color) : "transparent",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              opacity: 0,
              animation: `loftIn .7s cubic-bezier(.25,.8,.4,1) ${(0.06 + segIdx * 0.07).toFixed(2)}s forwards`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span
                onClick={(e) => {
                  onSeek(range.start);
                  if (popup?.type === "scene" && popup.segmentId === segment.id) {
                    onClosePopup();
                    return;
                  }
                  setPopupPos(computeAnchoredPosition(e.currentTarget, SCENE_POPUP_HEIGHT));
                  onRangeClick(segment.id);
                }}
                style={{
                  fontSize: "11px",
                  color: mode.textFaint3,
                  cursor: "pointer",
                  width: "fit-content",
                  padding: "2px 4px",
                  borderRadius: "4px",
                }}
              >
                {range.label}
              </span>

              {isConfirmingDelete ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "#FF6B6B", whiteSpace: "nowrap" }}>
                    {L.deleteSegmentConfirm}
                  </span>
                  <span
                    onClick={() => onConfirmDelete(segment.id)}
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#FF6B6B",
                      cursor: "pointer",
                      padding: "3px 8px",
                      borderRadius: "6px",
                      background: "rgba(255,107,107,.14)",
                    }}
                  >
                    {L.yes}
                  </span>
                  <span
                    onClick={onCancelDelete}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: mode.textFaint3,
                      cursor: "pointer",
                      padding: "3px 8px",
                      borderRadius: "6px",
                    }}
                  >
                    {L.no}
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "none" }}>
                  {/* Brush: only in per-phrase mode. Picks this segment for style editing
                      (arch §4.2). Accent-filled while it's the segment being edited. */}
                  {perPhraseStyle && (
                    <div
                      role="button"
                      aria-label={L.editSegmentStyle}
                      title={L.editSegmentStyle}
                      onClick={() => onEditSegmentStyle(segment.id)}
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "6px",
                        flex: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        background: isEditingStyle ? theme.accent : mode.iconBg,
                        color: isEditingStyle ? theme.text : mode.iconText,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
                        <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
                      </svg>
                    </div>
                  )}
                  <div
                    role="button"
                    aria-label={L.deleteSegment}
                    title={L.deleteSegment}
                    onClick={() => onDeleteClick(segment.id)}
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "6px",
                      flex: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: "#FF6B6B",
                      background: mode.iconBg,
                      fontSize: "12px",
                    }}
                  >
                    🗑
                  </div>
                </div>
              )}
            </div>

            <div style={{ fontSize: "16px", lineHeight: 1.6, display: "flex", flexWrap: "wrap", gap: "0 2px" }}>
              {segment.words.map((word, wordIdx) => {
                const isPending = pendingWordId === word.id;
                const isPopupTarget = popup?.type === "word" && popup.wordId === word.id;
                const isActiveWord = isActiveSegment && wordIdx === activeWordIdx;

                if (isPending || isPopupTarget) {
                  return (
                    <input
                      key={word.id}
                      autoFocus
                      value={draftText}
                      data-testid={isPending ? `pending-word-input-${word.id}` : `word-edit-input-${word.id}`}
                      onChange={(e) => setDraftText(e.target.value)}
                      onBlur={(e) => onCommitWordText(segment.id, word.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onCommitWordText(segment.id, word.id, e.currentTarget.value);
                          e.currentTarget.blur();
                          if (isPopupTarget) {
                            onClosePopup();
                          }
                        }
                      }}
                      style={{
                        width: Math.max(draftText.length, 1) + "ch",
                        minWidth: "20px",
                        fontSize: "16px",
                        padding: "1px 4px",
                        borderRadius: "4px",
                        border: "1px solid " + theme.accent,
                        background: mode.inputBg,
                        color: mode.textMain,
                      }}
                    />
                  );
                }

                const displayText =
                  !resolvedStyle || resolvedStyle.showPunctuation ? word.text : stripPunctuation(word.text);

                return (
                  <span
                    key={word.id}
                    onClick={(e) => {
                      onSeek(word.start);
                      setPopupPos(computeAnchoredPosition(e.currentTarget, WORD_POPUP_HEIGHT));
                      onWordClick(segment.id, word.id);
                    }}
                    style={{
                      cursor: "pointer",
                      borderRadius: "4px",
                      padding: "1px 3px",
                      fontWeight: isActiveWord ? 700 : 500,
                      color: isActiveWord ? color : mode.textMain,
                      textDecoration: isActiveWord ? "underline" : "none",
                    }}
                  >
                    {displayText || "…"}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}

      {popup?.type === "scene" && popupSegment && (
        <div style={popupCardStyle(mode, popupPos)}>
          <div style={popupTitleStyle(mode)}>{L.sceneDuration}</div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <input
              value={draftStart}
              inputMode="decimal"
              onChange={(e) => setDraftStart(e.target.value)}
              onBlur={(e) => onCommitSceneStart(popupSegment.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onCommitSceneStart(popupSegment.id, e.currentTarget.value);
                  e.currentTarget.blur();
                  onClosePopup();
                }
              }}
              style={popupInputStyle(mode)}
            />
            <input
              value={draftEnd}
              inputMode="decimal"
              onChange={(e) => setDraftEnd(e.target.value)}
              onBlur={(e) => onCommitSceneEnd(popupSegment.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onCommitSceneEnd(popupSegment.id, e.currentTarget.value);
                  e.currentTarget.blur();
                  onClosePopup();
                }
              }}
              style={popupInputStyle(mode)}
            />
          </div>
          <div onClick={onClosePopup} className="amee-cta-btn" style={popupCloseStyle(mode)}>
            {L.close}
          </div>
        </div>
      )}

      {popup?.type === "word" && popupSegment && popupWord && (
        <div style={popupCardStyle(mode, popupPos)}>
          {/* Line 1: the word's own start—end. Line 2: the segment's start—end (its outer span),
              not a per-word computed range. */}
          <div style={popupTitleStyle(mode)}>
            {popupWord.start.toFixed(2)} — {popupWord.end.toFixed(2)}
          </div>
          <div style={{ fontSize: "11px", color: mode.textFaint3, marginBottom: "10px" }}>
            {L.range}: {segmentRange(popupSegment).start.toFixed(2)}–
            {segmentRange(popupSegment).end.toFixed(2)}s
          </div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <input
              value={draftStart}
              inputMode="decimal"
              onChange={(e) => setDraftStart(e.target.value)}
              onBlur={(e) => onCommitWordStart(popupSegment.id, popupWord.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onCommitWordStart(popupSegment.id, popupWord.id, e.currentTarget.value);
                  e.currentTarget.blur();
                  onClosePopup();
                }
              }}
              style={popupInputStyle(mode)}
            />
            <input
              value={draftEnd}
              inputMode="decimal"
              onChange={(e) => setDraftEnd(e.target.value)}
              onBlur={(e) => onCommitWordEnd(popupSegment.id, popupWord.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onCommitWordEnd(popupSegment.id, popupWord.id, e.currentTarget.value);
                  e.currentTarget.blur();
                  onClosePopup();
                }
              }}
              style={popupInputStyle(mode)}
            />
          </div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <div
              onClick={() => onAddWord(popupSegment.id, popupWord.id, "left")}
              className="amee-cta-btn"
              title={L.addWordLeft}
              aria-label={L.addWordLeft}
              style={popupActionStyle(mode)}
            >
              ◀ {L.addWord}
            </div>
            <div
              onClick={() => onAddWord(popupSegment.id, popupWord.id, "right")}
              className="amee-cta-btn"
              title={L.addWordRight}
              aria-label={L.addWordRight}
              style={popupActionStyle(mode)}
            >
              {L.addWord} ▶
            </div>
          </div>
          <div
            onClick={() => onSplitSegment(popupSegment.id, popupWord.id)}
            className="amee-cta-btn"
            style={{ ...popupActionStyle(mode), marginBottom: "8px" }}
          >
            ✂ {L.splitSegment}
          </div>
          <div
            onClick={() => onRemoveWord(popupSegment.id, popupWord.id)}
            className="amee-cta-btn"
            style={{
              ...popupActionStyle(mode),
              color: "#FF6B6B",
              marginBottom: "8px",
            }}
          >
            🗑 {L.removeWord}
          </div>
          <div onClick={onClosePopup} className="amee-cta-btn" style={popupCloseStyle(mode)}>
            {L.close}
          </div>
        </div>
      )}
    </div>
  );
}

// Fixed ~8% tint for the active row's background, regardless of whether the underlying color
// is a plain hex or an rgba() string (highlightColors can now carry alpha folded in — see
// StylePanel's colorSwatchButton) — parseColorString normalizes both before re-composing.
function tint(color: string): string {
  return colorWithAlpha(parseColorString(color).hex, 8);
}

function popupCardStyle(mode: ModeColors, pos: { x: number; y: number }) {
  return {
    position: "absolute" as const,
    left: `${pos.x}px`,
    top: `${pos.y}px`,
    width: `${POPUP_WIDTH}px`,
    padding: "14px",
    borderRadius: "12px",
    background: mode.frameBg,
    border: "1px solid " + mode.cardBorder,
    boxShadow: "0 20px 50px rgba(0,0,0,.35)",
    zIndex: 20,
  };
}

function popupTitleStyle(mode: ModeColors) {
  return { fontSize: "13px", fontWeight: 700, color: mode.textMain, marginBottom: "10px" };
}

function popupInputStyle(mode: ModeColors) {
  return {
    flex: 1,
    // A flex item's default min-width is `auto` (its content size, not 0) -- for an <input>
    // that's the browser's native default width (~170px+), which overrides flex:1 and pokes
    // the input out past the popup's own edge. min-width:0 lets it actually shrink to fit.
    minWidth: 0,
    boxSizing: "border-box" as const,
    textAlign: "center" as const,
    fontSize: "13px",
    color: mode.textMain,
    background: mode.inputBg,
    border: "1px solid " + mode.cardBorder,
    borderRadius: "8px",
    padding: "6px 4px",
  };
}

function popupActionStyle(mode: ModeColors) {
  return {
    fontSize: "12.5px",
    fontWeight: 600,
    color: mode.textMain,
    background: mode.iconBg,
    borderRadius: "8px",
    padding: "8px 10px",
    textAlign: "center" as const,
    cursor: "pointer",
    flex: 1,
  };
}

function popupCloseStyle(mode: ModeColors) {
  return {
    fontSize: "12.5px",
    fontWeight: 600,
    color: mode.textFaint3,
    textAlign: "center" as const,
    cursor: "pointer",
    padding: "4px",
  };
}
