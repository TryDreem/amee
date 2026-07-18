import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import TopBar from "../components/TopBar";
import ProjectGrid from "../components/ProjectGrid";
import UploadZone from "../components/UploadZone";
import ProcessingStatus from "../components/ProcessingStatus";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import { useJobPolling } from "../hooks/useJobPolling";
import {
  ApiError,
  createProject,
  getProject,
  listProjects,
  transcribeProject,
  type Project,
} from "../api/client";
import { UI_MODES } from "../theme";

type View = "list" | "upload" | "processing";

function describeError(err: unknown): string {
  return err instanceof ApiError ? `${err.status}: ${err.message}` : "Something went wrong.";
}

export default function Home(): JSX.Element {
  const navigate = useNavigate();
  const { prefs, update } = useAmeePrefs();
  const [view, setView] = useState<View>("list");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { job, error: pollError } = useJobPolling(jobId);

  const refetchProjects = useCallback(() => {
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (!cancelled) {
          setProjects(result);
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
  }, []);

  useEffect(() => refetchProjects(), [refetchProjects]);

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

  function handleFileSelected(file: File) {
    setUploading(true);
    setUploadError(null);
    createProject(file)
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

  const mode = UI_MODES[prefs.mode];

  return (
    <div style={{ minHeight: "100vh", background: mode.pageBg }}>
      <TopBar prefs={prefs} onUpdatePrefs={update} />

      {view === "list" && (
        <>
          {listError && (
            <div role="alert" style={{ padding: "16px 32px", color: "#ef4444" }}>
              {listError}
            </div>
          )}
          <ProjectGrid prefs={prefs} projects={projects ?? []} onCreateClick={() => setView("upload")} />
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
