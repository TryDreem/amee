import type { Segment } from "../api/client";
import type { Strings } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";

export type WordPopup = { segmentId: string; wordId: string } | null;

interface CaptionsPanelProps {
  prefs: Prefs;
  strings: Strings;
  segments: Segment[];
  popup: WordPopup;
  confirmDeleteSegmentId: string | null;
  pendingWordId: string | null;
  onWordClick: (segmentId: string, wordId: string) => void;
  onClosePopup: () => void;
  onAddWord: (segmentId: string, wordId: string, side: "left" | "right") => void;
  onSplitSegment: (segmentId: string, wordId: string) => void;
  onDeleteClick: (segmentId: string) => void;
  onConfirmDelete: (segmentId: string) => void;
  onCancelDelete: () => void;
  onCommitPendingWord: (text: string) => void;
}

function segmentRange(segment: Segment): string {
  const first = segment.words[0];
  const last = segment.words.at(-1);
  if (!first || !last) {
    return "";
  }
  return `${first.start.toFixed(2)}–${last.end.toFixed(2)}s`;
}

export default function CaptionsPanel({
  prefs,
  strings: L,
  segments,
  popup,
  confirmDeleteSegmentId,
  pendingWordId,
  onWordClick,
  onClosePopup,
  onAddWord,
  onSplitSegment,
  onDeleteClick,
  onConfirmDelete,
  onCancelDelete,
  onCommitPendingWord,
}: CaptionsPanelProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const theme = resolveTheme(prefs.theme, prefs.mode);

  return (
    <div
      style={{
        maxWidth: "640px",
        margin: "28px auto 0",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {segments.map((segment) => {
        const isConfirmingDelete = confirmDeleteSegmentId === segment.id;
        return (
          <div
            key={segment.id}
            style={{
              padding: "14px 16px",
              borderRadius: "10px",
              border: "1px solid " + mode.cardBorder,
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: mode.textFaint3 }}>{segmentRange(segment)}</span>

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
                <div
                  role="button"
                  aria-label={L.deleteSegment}
                  title={L.deleteSegment}
                  onClick={() => onDeleteClick(segment.id)}
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "6px",
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
              )}
            </div>

            <div style={{ fontSize: "14px", lineHeight: 1.6 }}>
              {segment.words.map((word) => {
                const isSelected = popup?.wordId === word.id;
                const isPending = pendingWordId === word.id;
                return (
                  <span key={word.id} style={{ display: "inline-block", marginRight: "4px" }}>
                    {isPending ? (
                      <input
                        autoFocus
                        defaultValue=""
                        data-testid={`pending-word-input-${word.id}`}
                        onBlur={(e) => onCommitPendingWord(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        style={{
                          width: "70px",
                          fontSize: "14px",
                          padding: "1px 4px",
                          borderRadius: "4px",
                          border: "1px solid " + theme.accent,
                          background: mode.inputBg,
                          color: mode.textMain,
                        }}
                      />
                    ) : (
                      <span
                        onClick={() =>
                          isSelected ? onClosePopup() : onWordClick(segment.id, word.id)
                        }
                        style={{
                          cursor: "pointer",
                          borderRadius: "4px",
                          padding: "1px 3px",
                          color: mode.textMain,
                          background: isSelected
                            ? theme.accent
                            : isLight
                              ? "transparent"
                              : "transparent",
                        }}
                      >
                        {word.text || "…"}
                      </span>
                    )}
                    {isSelected && !isPending && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          marginLeft: "6px",
                          padding: "2px 4px",
                          borderRadius: "8px",
                          background: mode.cardBg,
                          border: "1px solid " + mode.cardBorder,
                          verticalAlign: "middle",
                        }}
                      >
                        <span
                          role="button"
                          aria-label={L.addWordLeft}
                          title={L.addWordLeft}
                          onClick={() => onAddWord(segment.id, word.id, "left")}
                          style={popupBtnStyle(mode.textFaint2)}
                        >
                          ◀
                        </span>
                        <span
                          role="button"
                          aria-label={L.splitSegment}
                          title={L.splitSegment}
                          onClick={() => onSplitSegment(segment.id, word.id)}
                          style={popupBtnStyle(mode.textFaint2)}
                        >
                          ✂
                        </span>
                        <span
                          role="button"
                          aria-label={L.addWordRight}
                          title={L.addWordRight}
                          onClick={() => onAddWord(segment.id, word.id, "right")}
                          style={popupBtnStyle(mode.textFaint2)}
                        >
                          ▶
                        </span>
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function popupBtnStyle(color: string) {
  return {
    cursor: "pointer",
    fontSize: "11px",
    padding: "3px 5px",
    borderRadius: "5px",
    color,
  } as const;
}
