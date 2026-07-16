export type Mode = "dark" | "light";
export type ThemeKey = "navy" | "mono";
export type Lang = "ru" | "en";

export interface ModeColors {
  pageBg: string;
  frameBg: string;
  sidebarBg: string;
  panelBorder: string;
  panelBorder2: string;
  textMain: string;
  textFaint: string;
  textFaint2: string;
  textFaint3: string;
  cardBg: string;
  cardBorder: string;
  cardBorderHover: string;
  iconBg: string;
  iconText: string;
  stripeA: string;
  stripeB: string;
  inputBg: string;
  dashBorder: string;
  dashBorderHover: string;
}

export const UI_MODES: Record<Mode, ModeColors> = {
  dark: {
    pageBg: "#0b0b0d",
    frameBg: "#141416",
    sidebarBg: "#191a1c",
    panelBorder: "rgba(255,255,255,.06)",
    panelBorder2: "rgba(255,255,255,.08)",
    textMain: "#ffffff",
    textFaint: "rgba(255,255,255,.5)",
    textFaint2: "rgba(255,255,255,.65)",
    textFaint3: "rgba(255,255,255,.4)",
    cardBg: "rgba(255,255,255,.045)",
    cardBorder: "rgba(255,255,255,.08)",
    cardBorderHover: "rgba(255,255,255,.18)",
    iconBg: "rgba(255,255,255,.06)",
    iconText: "rgba(255,255,255,.6)",
    stripeA: "#25272b",
    stripeB: "#1c1e21",
    inputBg: "#0e0e10",
    dashBorder: "rgba(255,255,255,.18)",
    dashBorderHover: "rgba(255,255,255,.32)",
  },
  light: {
    pageBg: "#f3f3f4",
    frameBg: "#ffffff",
    sidebarBg: "#ffffff",
    panelBorder: "rgba(0,0,0,.08)",
    panelBorder2: "rgba(0,0,0,.09)",
    textMain: "#17171a",
    textFaint: "rgba(0,0,0,.55)",
    textFaint2: "rgba(0,0,0,.6)",
    textFaint3: "rgba(0,0,0,.4)",
    cardBg: "#ffffff",
    cardBorder: "rgba(0,0,0,.08)",
    cardBorderHover: "rgba(0,0,0,.16)",
    iconBg: "rgba(0,0,0,.05)",
    iconText: "rgba(0,0,0,.55)",
    stripeA: "#dcdcdf",
    stripeB: "#c9c9cd",
    inputBg: "#f1f1f2",
    dashBorder: "rgba(0,0,0,.15)",
    dashBorderHover: "rgba(0,0,0,.3)",
  },
};

export interface AccentTheme {
  label: string;
  accent: string;
  text: string;
  tint?: string;
}

export function resolveTheme(theme: ThemeKey, mode: Mode): AccentTheme {
  if (theme === "mono") {
    const isLight = mode === "light";
    return {
      label: "Mono",
      accent: isLight ? "#0b0b0d" : "#ffffff",
      text: isLight ? "#ffffff" : "#0b0b0d",
    };
  }
  return { label: "Navy", accent: "#5B4FE8", tint: "91,79,232", text: "#ffffff" };
}

export const THEME_ORDER: ThemeKey[] = ["navy", "mono"];

export interface Prefs {
  theme: ThemeKey;
  mode: Mode;
  lang: Lang;
}

const LS_THEME = "amee_theme";
const LS_MODE = "amee_mode";
const LS_LANG = "amee_lang";

const DEFAULT_PREFS: Prefs = { theme: "mono", mode: "dark", lang: "en" };

function isThemeKey(value: string): value is ThemeKey {
  return value === "navy" || value === "mono";
}

function isMode(value: string): value is Mode {
  return value === "dark" || value === "light";
}

function isLang(value: string): value is Lang {
  return value === "ru" || value === "en";
}

export function loadPrefs(): Prefs {
  try {
    const theme = localStorage.getItem(LS_THEME);
    const mode = localStorage.getItem(LS_MODE);
    const lang = localStorage.getItem(LS_LANG);
    return {
      theme: theme && isThemeKey(theme) ? theme : DEFAULT_PREFS.theme,
      mode: mode && isMode(mode) ? mode : DEFAULT_PREFS.mode,
      lang: lang && isLang(lang) ? lang : DEFAULT_PREFS.lang,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(LS_THEME, prefs.theme);
    localStorage.setItem(LS_MODE, prefs.mode);
    localStorage.setItem(LS_LANG, prefs.lang);
  } catch {
    // localStorage unavailable (private mode, etc.) — prefs just don't persist.
  }
}
