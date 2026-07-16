import { useCallback, useEffect, useState } from "react";

import TopBar from "../components/TopBar";
import ProjectGrid from "../components/ProjectGrid";
import UploadZone from "../components/UploadZone";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import { ApiError, createProject, listProjects, type Project } from "../api/client";
import { UI_MODES } from "../theme";

type View = "list" | "upload";

function describeError(err: unknown): string {
  return err instanceof ApiError ? `${err.status}: ${err.message}` : "Something went wrong.";
}

export default function Home(): JSX.Element {
  const { prefs, update } = useAmeePrefs();
  const [view, setView] = useState<View>("list");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  function handleFileSelected(file: File) {
    setUploading(true);
    setUploadError(null);
    createProject(file)
      .then(() => {
        setView("list");
        refetchProjects();
      })
      .catch((err: unknown) => {
        setUploadError(describeError(err));
      })
      .finally(() => {
        setUploading(false);
      });
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
    </div>
  );
}
