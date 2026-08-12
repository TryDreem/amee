import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import DeleteProjectModal from "../components/DeleteProjectModal";
import ExportBadge from "../components/ExportBadge";
import ExportModal from "../components/ExportModal";
import ExportToast from "../components/ExportToast";
import TopBar from "../components/TopBar";
import ProjectGrid from "../components/ProjectGrid";
import SavedToast from "../components/SavedToast";
import UploadZone from "../components/UploadZone";
import ProcessingStatus from "../components/ProcessingStatus";
import { useExport } from "../contexts/ExportContext";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import { useJobPolling } from "../hooks/useJobPolling";
import {
  ApiError,
  createProject,
  deleteProject,
  getProject,
  isTerminalJobStatus,
  listProjects,
  resolveMediaUrl,
  transcribeProject,
  type Project,
  type ProjectPage,
  type ProjectSort,
} from "../api/client";
import { STR } from "../i18n";
import { triggerDownload } from "../lib/download";
import { AUTO_LANGUAGE_CODE } from "../lib/languages";
import { UI_MODES } from "../theme";

type View = "list" | "upload" | "processing";

// contract §4's own default; also the design's PAGE_SIZE (Home.dc.html).
const PAGE_SIZE = 8;
// Debounces the search box's network call, not its own displayed value -- the input stays
// instantly responsive (a plain controlled input), only the re-fetch waits.
const SEARCH_DEBOUNCE_MS = 300;

function describeError(err: unknown): string {
  return err instanceof ApiError ? `${err.status}: ${err.message}` : "Something went wrong.";
}

export default function Home(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { prefs, update } = useAmeePrefs();
  const [view, setView] = useState<View>("list");
  // Set by the Editor's home icon (design: e_onGoHome's sessionStorage flag; a router-state flag
  // is the SPA equivalent of the same "flag it, land here, read it once" trick) -- played once,
  // then the router state is cleared so a refresh or back-navigation doesn't replay it.
  const [showSavedToast, setShowSavedToast] = useState(false);
  const savedToastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [projectPage, setProjectPage] = useState<ProjectPage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Search/sort/pagination (Step 11e, contract §4). `searchInput` is the raw controlled-input
  // value (updates every keystroke); `searchQuery` is what actually goes on the wire, debounced
  // so typing doesn't fire a request per character.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("newest");
  const [page, setPage] = useState(0);

  // Step 11f: delete confirmation (design: confirmDeleteProject) -- a centered modal, distinct
  // from the Editor's own inline segment-delete confirm. `deleteTarget` is the whole Project, not
  // just an id, so the modal can show its name without a re-fetch.
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { job, error: pollError } = useJobPolling(jobId);

  // Step 11d: Home's export ring badge (design: h_exportBadge*) reads the same cross-page context
  // Editor writes to (Step 11a) -- unscoped by project, since this page shows exports from every
  // project at once. Only the "video" kind ever gets a modal/toast (the ⋯ menu's SRT export was
  // never wired into the design's export-panel system either -- Step 11b/11c's own restriction,
  // applied identically here).
  const exportCtx = useExport();
  const videoExportRecords = exportCtx.records.filter((r) => r.kind === "video");
  const activeExportRecords = videoExportRecords.filter((r) => {
    const job_ = exportCtx.jobsById[r.id];
    return job_ != null && (job_.status === "queued" || job_.status === "processing");
  });
  // `records` is append-ordered, so the first active one is the one that's been running longest --
  // the real-data equivalent of the design's "highest fake progress" leader, since both models
  // agree on the same ordering when every export advances at the same rate.
  const leadingExportRecord = activeExportRecords[0] ?? videoExportRecords[0] ?? null;
  const openExportRecord = videoExportRecords.find((r) => !r.minimized) ?? null;
  const openExportJob = openExportRecord ? exportCtx.jobsById[openExportRecord.id] : undefined;
  const toastExportRecord =
    videoExportRecords.find((r) => {
      const job_ = exportCtx.jobsById[r.id];
      return r.minimized && job_ != null && isTerminalJobStatus(job_.status);
    }) ?? null;
  const toastExportJob = toastExportRecord ? exportCtx.jobsById[toastExportRecord.id] : undefined;

  function handleExportBadgeClick() {
    if (leadingExportRecord) {
      exportCtx.reopen(leadingExportRecord.id);
    }
  }

  // Same "stop watching, keep it dismissed" honesty as the Editor's own exits (Step 11b) -- real
  // cancellation is Track 2/backend work, not landed yet. From Home there's nowhere to "return"
  // to for Cancel/Return-to-menu (already here); Continue-editing/Return-to-editor instead take
  // the user to that project's editor, since unlike the Editor's own modal, Home isn't already
  // showing it.
  function handleExportDismiss() {
    if (openExportRecord) {
      exportCtx.dismiss(openExportRecord.id);
    }
  }

  function handleExportGoToEditor() {
    if (openExportRecord) {
      const projectId = openExportRecord.projectId;
      exportCtx.dismiss(openExportRecord.id);
      navigate(`/projects/${projectId}`);
    }
  }

  function handleExportToastDownload() {
    if (!toastExportRecord || !toastExportJob) {
      return;
    }
    const url = exportCtx.videoUrl(toastExportJob);
    if (url) {
      void triggerDownload(resolveMediaUrl(url), "video.mp4").catch(() => {
        /* the toast's Open action remains the way to reach it */
      });
    }
  }

  // Debounce: searchInput updates the input instantly, searchQuery (what's actually sent) lags
  // behind by SEARCH_DEBOUNCE_MS so a fast typist doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // A new search or sort invalidates the current page number (design: h_onSearchChange resets
  // page to 0 the same way) -- otherwise "page 3" could silently point past the new, smaller
  // result set.
  useEffect(() => {
    setPage(0);
  }, [searchQuery, sort]);

  const refetchProjects = useCallback(() => {
    let cancelled = false;
    listProjects({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, q: searchQuery || undefined, sort })
      .then((result) => {
        if (!cancelled) {
          setProjectPage(result);
          setListError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setListError(describeError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [page, searchQuery, sort]);

  useEffect(() => refetchProjects(), [refetchProjects]);

  useEffect(() => {
    const state = location.state as { justSaved?: boolean } | null;
    if (!state?.justSaved) {
      return;
    }
    setShowSavedToast(true);
    navigate(location.pathname, { replace: true, state: {} });
    savedToastTimerRef.current = setTimeout(() => setShowSavedToast(false), 1600);
    return () => clearTimeout(savedToastTimerRef.current);
    // Runs once on mount only -- this consumes a one-shot navigation flag, not something that
    // should replay on every location/navigate identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTranscribe(project: Project) {
    setStartError(null);
    setJobId(null);
    transcribeProject(project.id)
      .then((job_) => {
        setJobId(job_.id);
      })
      .catch((err: unknown) => {
        // A 409 means a transcribe job already exists for this project — that's not a
        // failure, we just need to find and poll the job that's already running.
        if (err instanceof ApiError && err.status === 409) {
          getProject(project.id)
            .then((fresh) => {
              if (fresh.latest_transcribe_job_id) {
                setJobId(fresh.latest_transcribe_job_id);
              } else {
                setStartError(describeError(err));
              }
            })
            .catch(() => {
              setStartError(describeError(err));
            });
          return;
        }
        setStartError(describeError(err));
      });
  }

  function handleFileSelected(file: File, language: string) {
    setUploading(true);
    setUploadError(null);
    createProject(file, undefined, language === AUTO_LANGUAGE_CODE ? undefined : language)
      .then((project) => {
        setUploading(false);
        setActiveProject(project);
        setView("processing");
        startTranscribe(project);
      })
      .catch((err: unknown) => {
        setUploading(false);
        setUploadError(describeError(err));
      });
  }

  function handleOpenEditor() {
    if (!activeProject) {
      return;
    }
    navigate(`/projects/${activeProject.id}`);
  }

  function handleDeleteClick(project: Project) {
    setDeleteError(null);
    setDeleteTarget(project);
  }

  function handleDeleteCancel() {
    if (deleting) {
      return; // don't let the backdrop/No click abandon an in-flight request
    }
    setDeleteTarget(null);
    setDeleteError(null);
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    deleteProject(deleteTarget.id)
      .then(() => {
        setDeleting(false);
        setDeleteTarget(null);
        refetchProjects();
      })
      .catch((err: unknown) => {
        setDeleting(false);
        // 409: a transcribe job is still queued/processing -- the backend refuses rather than
        // cancelling it (contract §4: WhisperX has no OS process to signal, unlike export).
        // 404: already gone (e.g. deleted from another tab) -- treat as success, refresh the list.
        if (err instanceof ApiError && err.status === 409) {
          setDeleteError(L.deleteFailedActiveJob);
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setDeleteTarget(null);
          refetchProjects();
          return;
        }
        setDeleteError(describeError(err));
      });
  }

  const mode = UI_MODES[prefs.mode];
  const L = STR[prefs.lang];

  return (
    <div style={{ minHeight: "100vh", background: mode.pageBg }}>
      {showSavedToast && <SavedToast prefs={prefs} text={L.projectSaved} />}
      {deleteTarget && (
        <DeleteProjectModal
          prefs={prefs}
          strings={L}
          projectName={deleteTarget.name}
          busy={deleting}
          errorMessage={deleteError}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
      {openExportRecord && openExportJob && (
        <ExportModal
          prefs={prefs}
          strings={L}
          projectName={openExportRecord.projectName}
          status={openExportJob.status}
          errorMessage={openExportJob.error ?? exportCtx.pollErrorsById[openExportRecord.id] ?? null}
          onCancel={handleExportDismiss}
          onReturnToMenu={handleExportDismiss}
          onContinueEditing={handleExportGoToEditor}
          onReturnToEditor={handleExportGoToEditor}
          onMinimize={() => exportCtx.minimize(openExportRecord.id)}
        />
      )}
      {toastExportRecord && toastExportJob && isTerminalJobStatus(toastExportJob.status) && (
        <ExportToast
          prefs={prefs}
          strings={L}
          status={toastExportJob.status}
          onOpen={() => exportCtx.reopen(toastExportRecord.id)}
          onDownload={toastExportJob.status === "done" ? handleExportToastDownload : undefined}
          onDismiss={() => exportCtx.dismiss(toastExportRecord.id)}
        />
      )}
      <TopBar
        prefs={prefs}
        onUpdatePrefs={update}
        beforeMenu={
          activeExportRecords.length > 0 && (
            <ExportBadge
              prefs={prefs}
              count={activeExportRecords.length}
              title={L.exportsInProgress(activeExportRecords.length)}
              onClick={handleExportBadgeClick}
            />
          )
        }
      />

      {view === "list" && (
        <>
          {listError && (
            <div role="alert" style={{ padding: "16px 32px", color: "#ef4444" }}>
              {listError}
            </div>
          )}
          <ProjectGrid
            prefs={prefs}
            projects={projectPage?.items ?? []}
            total={projectPage?.total ?? 0}
            onCreateClick={() => setView("upload")}
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            sort={sort}
            onSortChange={setSort}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onDeleteClick={handleDeleteClick}
          />
        </>
      )}

      {view === "upload" && (
        <UploadZone
          prefs={prefs}
          onBack={() => setView("list")}
          onFileSelected={handleFileSelected}
          busy={uploading}
          errorMessage={uploadError}
        />
      )}

      {view === "processing" && activeProject && (
        <ProcessingStatus
          prefs={prefs}
          fileName={activeProject.name}
          job={job}
          pollError={pollError}
          startError={startError}
          onRetry={() => startTranscribe(activeProject)}
          onOpenEditor={handleOpenEditor}
        />
      )}
    </div>
  );
}
