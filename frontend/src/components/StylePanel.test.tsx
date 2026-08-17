import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Preset } from "../api/client";
import { STR } from "../i18n";
import { hexToRgb } from "../lib/color";
import { presetsFixture } from "../mocks/fixtures";
import { resolveTheme, type Prefs } from "../theme";
import StylePanel from "./StylePanel";

const prefs: Prefs = { lang: "en", mode: "dark", theme: "navy" };

const basePreset = presetsFixture[0] as Preset;

// Two presets that differ in every way a card preview is supposed to show: family, case, colour,
// outline, and entrance animation.
const presets: Preset[] = [
  basePreset,
  {
    ...basePreset,
    id: "preset-punch",
    name: "Viral Punch",
    default: false,
    base: {
      ...basePreset.base,
      fontFamily: "Russo One",
      textTransform: "uppercase",
      highlightColors: ["#ffe600"],
      outline: { size: "large", color: "#000000", alpha: 100 },
      captionAnimation: "pop",
    },
  },
];

function renderPanel(overrides?: Partial<Parameters<typeof StylePanel>[0]>) {
  return render(
    <StylePanel
      prefs={prefs}
      strings={STR.en}
      presets={presets}
      activePresetId={basePreset.id}
      resolvedStyle={basePreset.base}
      bounds={basePreset.bounds}
      onSelectPreset={vi.fn()}
      onChangeOverrides={vi.fn()}
      onLiveChangeOverrides={vi.fn()}
      onCommitOverrides={vi.fn()}
      {...overrides}
    />
  );
}

describe("StylePanel reveal mode", () => {
  // "phrase" is still a valid wire value and both renderers still handle it, but it has no
  // button: it never meant "the whole phrase at once" (every word still enters at its own start),
  // so the only thing it changed versus "progressive" was painting every word in the highlight
  // colour. The look it seemed to promise is `captionAnimation: "none"`.
  it("offers word-by-word and one-word, and no whole-phrase choice", () => {
    renderPanel();
    fireEvent.click(screen.getByText(STR.en.captionAnimationLabel));

    expect(screen.getByText(STR.en.revealModeProgressive)).toBeInTheDocument();
    expect(screen.getByText(STR.en.revealModeSingleWord)).toBeInTheDocument();
    expect(screen.queryByText("Whole phrase")).not.toBeInTheDocument();
  });

  it("writes only revealMode, leaving the chosen animation alone", () => {
    const onChangeOverrides = vi.fn();
    renderPanel({ onChangeOverrides });
    fireEvent.click(screen.getByText(STR.en.captionAnimationLabel));
    fireEvent.click(screen.getByText(STR.en.revealModeSingleWord));

    expect(onChangeOverrides).toHaveBeenCalledWith({ revealMode: "single-word" });
  });
});

describe("StylePanel font gallery", () => {
  // jsdom normalises the inline hex to rgb(), so compare against that form.
  const { r, g, b } = hexToRgb(resolveTheme(prefs.theme, prefs.mode).accent);
  const accent = `rgb(${r}, ${g}, ${b})`;

  // getAllByText, not getByText: "Outline" is both a font card and the label of the outline-size
  // control in the pinned strip below.
  function cardFor(label: string): HTMLElement {
    for (const el of screen.getAllByText(label)) {
      const card = el.closest(".amee-grid-card");
      if (card instanceof HTMLElement) {
        return card;
      }
    }
    throw new Error(`no card for ${label}`);
  }

  // The reported bug: pick a font, change the weight, and the gallery goes blank — it claimed no
  // font was chosen while that font was plainly in use.
  it("keeps a font selected after its weight is changed from the control below", () => {
    renderPanel({
      resolvedStyle: {
        ...basePreset.base,
        fontFamily: "Archivo Black",
        fontWeight: 900, // the card itself bundles 400
        textTransform: "uppercase",
      },
    });

    expect(cardFor("Archivo Black").style.border).toContain(accent);
  });

  // ...but family alone can't decide it: Clean, Neon Glow and Outline are three different looks
  // built on Inter, and lighting up all three would be its own kind of wrong.
  it("selects exactly one card when several looks share a family", () => {
    renderPanel({
      resolvedStyle: { ...basePreset.base, fontFamily: "Inter", fontWeight: 700, glow: true },
    });

    expect(cardFor("Neon Glow").style.border).toContain(accent);
    expect(cardFor("Clean").style.border).not.toContain(accent);
    expect(cardFor("Outline").style.border).not.toContain(accent);
  });

  // Every card used to carry its own preview colour, and the dark slate ones were invisible on
  // the dark theme's card.
  it("draws every font name in the theme's text colour", () => {
    renderPanel();
    for (const label of ["Anton", "Clean", "Archivo Black", "Pacifico"]) {
      expect(screen.getByText(label).style.color).toBe("rgb(255, 255, 255)");
    }
  });
});

describe("StylePanel preset cards", () => {
  // A card that only printed the preset's name told the user nothing about what picking it does.
  it("draws each preset's name in that preset's own font, case, colour and entrance", () => {
    renderPanel();

    const plain = screen.getByText(basePreset.name);
    const punch = screen.getByText("Viral Punch");

    expect(punch.style.fontFamily).toContain("Russo One");
    expect(punch.style.textTransform).toBe("uppercase");
    expect(punch.style.color).toBe("rgb(255, 230, 0)");
    // Outline is drawn as a stroke whose width is a fraction of the preview font size, the same
    // ratio the real caption uses (lib/captionDecoration) -- not a fixed 1px hairline.
    expect(punch.style.webkitTextStroke).toMatch(/^2\.04px /);
    expect(punch.style.animation).toContain("capPop");

    // ...and a preset with no entrance and no outline gets neither.
    expect(plain.style.animation).toBe("");
    expect(plain.style.webkitTextStroke).toBe("");
  });
});
