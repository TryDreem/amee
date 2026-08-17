import { STR } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";
import { resolveMediaUrl, type Job } from "../api/client";

const PHASE_ORDER = ["preparing", "transcribing", "generating_preview"] as const;
type Phase = (typeof PHASE_ORDER)[number];

interface ProcessingStatusProps {
  prefs: Prefs;
  fileName: string;
  job: Job | null;
  pollError: string | null;
  startError: string | null;
  onRetry: () => void;
  onOpenEditor: () => void;
  // Leaves this screen without stopping anything: the job is tracked by TranscribeContext, which
  // keeps polling from wherever the user goes and raises a toast when it lands.
  onBackToMenu: () => void;
}

export default function ProcessingStatus({
  prefs,
  fileName,
  job,
  pollError,
  startError,
  onRetry,
  onOpenEditor,
  onBackToMenu,
}: ProcessingStatusProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const L = STR[prefs.lang];

  const jobFailed = job?.status === "failed";
  const isFailed = Boolean(startError) || Boolean(pollError) || jobFailed;
  const isDone = job?.status === "done" && !isFailed;

  const activeIdx = isDone
    ? PHASE_ORDER.length
    : job?.status === "processing"
      ? PHASE_ORDER.indexOf((job.progress ?? "preparing") as Phase)
      : -1;

  const phaseLabels: Record<Phase, string> = {
    preparing: L.procPreparing,
    transcribing: L.procTranscribing,
    generating_preview: L.procGeneratingPreview,
  };

  const activePhase = activeIdx >= 0 ? PHASE_ORDER[activeIdx] : undefined;
  const headline = isFailed
    ? L.procFailed
    : isDone
      ? L.procDone
      : activePhase
        ? phaseLabels[activePhase]
        : L.procQueued;

  const errorDetail = startError ?? pollError ?? (jobFailed ? (job?.error ?? null) : null);

  const actionBtnStyle = {
    marginTop: "22px",
    fontSize: "13.5px",
    fontWeight: 700,
    color: theme.text,
    background: theme.accent,
    padding: "12px 26px",
    borderRadius: "10px",
    textAlign: "center" as const,
    display: "inline-block",
    width: "fit-content",
    cursor: "pointer",
  };

  const secondaryBtnStyle = {
    fontSize: "13px",
    fontWeight: 600,
    color: mode.iconText,
    background: mode.iconBg,
    padding: "10px 22px",
    borderRadius: "10px",
    textAlign: "center" as const,
    display: "inline-block",
    width: "fit-content",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "64px 32px 80px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "48px",
        alignItems: "center",
        minHeight: "calc(100vh - 64px)",
        animation: "homeUploadIn .4s ease both",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "440px" }}>
        <div style={{ fontSize: "12.5px", fontWeight: 600, color: mode.textFaint3 }}>{fileName}</div>
        <div
          style={{
            fontSize: "26px",
            fontWeight: 800,
            color: mode.textMain,
            letterSpacing: "-.01em",
            lineHeight: 1.2,
          }}
        >
          {headline}
        </div>
        {isDone && (
          <div style={{ fontSize: "14.5px", color: mode.textFaint, marginBottom: "8px" }}>
            {L.procDoneSub}
          </div>
        )}
        {isFailed && errorDetail && (
          <div role="alert" style={{ fontSize: "13.5px", color: "#ef4444" }}>
            {errorDetail}
          </div>
        )}

        {!isFailed && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "10px" }}>
            {PHASE_ORDER.map((phase, i) => {
              const isDoneStep = i < activeIdx || isDone;
              const isActive = i === activeIdx && !isDone;
              return (
                <div
                  key={phase}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "14.5px",
                    fontWeight: isActive ? 700 : 500,
                    color: isDoneStep ? mode.textMain : isActive ? theme.accent : mode.textFaint3,
                  }}
                >
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      flex: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isDoneStep || isActive ? theme.accent : mode.textFaint3,
                    }}
                  >
                    {isDoneStep ? (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isActive ? (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        style={{ animation: "starSpin 1.1s linear infinite" }}
                      >
                        <path d="M12 2l1.9 6.6L20 11l-6.1 2.4L12 20l-1.9-6.6L4 11l6.1-2.4z" />
                      </svg>
                    ) : (
                      <div
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          border: "2px solid " + mode.textFaint3,
                        }}
                      />
                    )}
                  </div>
                  <span>{phaseLabels[phase]}</span>
                </div>
              );
            })}
          </div>
        )}

        {isDone && (
          <div onClick={onOpenEditor} className="amee-cta-btn" style={actionBtnStyle}>
            {L.openInEditor}
          </div>
        )}
        {isFailed && (
          <div onClick={onRetry} className="amee-cta-btn" style={actionBtnStyle}>
            {L.retry}
          </div>
        )}

        {/* Always available, including once the job is done -- there is nothing here that has to
            be watched, and the hint below says so, because a screen with a progress list on it
            reads as "do not leave" unless it is told otherwise. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "18px" }}>
          <div onClick={onBackToMenu} className="amee-cta-btn" style={secondaryBtnStyle}>
            {L.returnToMenu}
          </div>
          {!isDone && !isFailed && (
            <div style={{ fontSize: "12px", color: mode.textFaint3 }}>{L.procKeepsRunning}</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: "280px",
            aspectRatio: "9/16",
            borderRadius: "20px",
            position: "relative",
            overflow: "hidden",
            background: job?.thumbnail_url
              ? undefined
              : `repeating-linear-gradient(135deg,${mode.stripeA},${mode.stripeA} 14px,${mode.stripeB} 14px,${mode.stripeB} 28px)`,
            boxShadow: "0 30px 70px rgba(0,0,0,.4)",
            border: "1px solid " + mode.panelBorder,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {job?.thumbnail_url ? (
            <img
              src={resolveMediaUrl(job.thumbnail_url)}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                font: "11px ui-monospace,Menlo,monospace",
                color: isLight ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.4)",
              }}
            >
              {L.thumbLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
