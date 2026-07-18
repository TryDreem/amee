export interface VideoLanguage {
  code: string;
  flag: string;
  name: string;
}

// ISO 639-1 codes, all confirmed present in the backend's WhisperX whitelist
// (backend/app/services/language.py) — ported from the Claude Design source
// (Home.dc.html's VIDEO_LANGUAGES).
export const VIDEO_LANGUAGES: VideoLanguage[] = [
  { code: "en", flag: "🇺🇸", name: "English" },
  { code: "es", flag: "🇪🇸", name: "Spanish" },
  { code: "fr", flag: "🇫🇷", name: "French" },
  { code: "de", flag: "🇩🇪", name: "German" },
  { code: "it", flag: "🇮🇹", name: "Italian" },
  { code: "pt", flag: "🇵🇹", name: "Portuguese" },
  { code: "ru", flag: "🇷🇺", name: "Russian" },
  { code: "zh", flag: "🇨🇳", name: "Chinese (Mandarin)" },
  { code: "ja", flag: "🇯🇵", name: "Japanese" },
  { code: "ko", flag: "🇰🇷", name: "Korean" },
  { code: "ar", flag: "🇸🇦", name: "Arabic" },
  { code: "hi", flag: "🇮🇳", name: "Hindi" },
  { code: "tr", flag: "🇹🇷", name: "Turkish" },
  { code: "nl", flag: "🇳🇱", name: "Dutch" },
  { code: "pl", flag: "🇵🇱", name: "Polish" },
  { code: "sv", flag: "🇸🇪", name: "Swedish" },
  { code: "vi", flag: "🇻🇳", name: "Vietnamese" },
  { code: "id", flag: "🇮🇩", name: "Indonesian" },
  { code: "uk", flag: "🇺🇦", name: "Ukrainian" },
  { code: "el", flag: "🇬🇷", name: "Greek" },
  { code: "cs", flag: "🇨🇿", name: "Czech" },
  { code: "ro", flag: "🇷🇴", name: "Romanian" },
  { code: "hu", flag: "🇭🇺", name: "Hungarian" },
  { code: "fi", flag: "🇫🇮", name: "Finnish" },
  { code: "da", flag: "🇩🇰", name: "Danish" },
  { code: "no", flag: "🇳🇴", name: "Norwegian" },
  { code: "th", flag: "🇹🇭", name: "Thai" },
  { code: "he", flag: "🇮🇱", name: "Hebrew" },
  { code: "bg", flag: "🇧🇬", name: "Bulgarian" },
  { code: "ms", flag: "🇲🇾", name: "Malay" },
];

// Local UI sentinel only. Selecting it means "omit `language` from the
// upload request" (contract §4: omitted/null = auto-detect) — never send
// the literal string "auto" over the wire.
export const AUTO_LANGUAGE_CODE = "auto";
