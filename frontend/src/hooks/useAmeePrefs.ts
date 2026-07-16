import { useCallback, useState } from "react";

import { loadPrefs, savePrefs, type Prefs } from "../theme";

export interface UseAmeePrefs {
  prefs: Prefs;
  update: (patch: Partial<Prefs>) => void;
}

export function useAmeePrefs(): UseAmeePrefs {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
