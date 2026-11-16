// One solid-blue primary action per view; everything else is neutral. Only palette colours remapped for the light theme are used.
const base = "inline-flex items-center justify-center gap-1.5 rounded text-sm font-medium disabled:opacity-50";

export const btnPrimary = `${base} bg-[#58a6ff] px-3 py-1.5 text-[#0d1117] hover:opacity-90`;
export const btnSecondary = `${base} border border-[#30363d] px-3 py-1.5 text-[#c9d1d9] hover:border-[#58a6ff]`;
export const btnGhost = "inline-flex items-center justify-center rounded p-1.5 text-[#8b949e] hover:bg-[#161b22] disabled:opacity-40";
export const selectClass = "rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-[#c9d1d9]";
