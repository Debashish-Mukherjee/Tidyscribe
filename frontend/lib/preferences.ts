export const TONES = ["Solution Design", "HLD", "LLD", "ADR", "RFC", "Runbook", "Operational Guide"] as const;
export type Tone = (typeof TONES)[number];

export const PREF_THEME = "ui.theme";
export const PREF_TONE = "editor.default_tone";
export const PREF_PASTE_MODE = "editor.paste_mode";

export const isTone = (value: unknown): value is Tone => TONES.includes(value as Tone);

/** Controls the Settings panel needs from the workbench. */
export type PreferenceControls = {
  theme: "dark" | "light" | "system";
  onThemeChange: (mode: "dark" | "light" | "system") => void;
  tone: Tone;
  onToneChange: (tone: Tone) => void;
  onResetLayout: () => void;
};
