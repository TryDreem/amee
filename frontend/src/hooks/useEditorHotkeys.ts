import { useEffect } from "react";

interface UseEditorHotkeysArgs {
  togglePlay: () => void;
  undo: () => void;
  redo: () => void;
}

// Step 7c: Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z, matching the Behavior Matrix's "button or keyboard
// shortcut" wording, plus Space for playback. Every callback here is stable (the player reads its
// element through a ref, undo/redo read history through a ref), so this listener attaches once
// rather than re-subscribing on every edit.
export function useEditorHotkeys({ togglePlay, undo, redo }: UseEditorHotkeysArgs): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Shared by every shortcut below: typing must always win over a shortcut, and the caption
      // editor is a contenteditable where a literal space is the most common keystroke in the app.
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      if (isEditable) {
        return;
      }

      // Space toggles playback, the way every video tool behaves. Bound at the window rather than
      // the player so it works wherever attention is — scrolling the caption list, tuning a style
      // slider — which is exactly when you want to re-check timing without reaching for the mouse.
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Buttons and range inputs treat Space as "activate"/"nudge" of their own; hijacking it
        // there would break Play, Export, and the position slider for keyboard users.
        if (target?.closest("button, [role='button'], input[type='range']")) {
          return;
        }
        e.preventDefault(); // default Space scrolls the page
        togglePlay();
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay, undo, redo]);
}
