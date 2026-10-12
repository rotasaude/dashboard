// Tema por pessoa (spec do subprojeto 2, §5.1). Salvo no navegador; se o
// armazenamento falhar (modo privado, bloqueio), vale a escolha em memória
// durante a sessão e, sem escolha, o govbr.
import { useSyncExternalStore } from "react";

export const THEME_KEY = "rotasaude:theme";
const PREV_KEY = "rotasaude:theme:prev";
export const PANEL_THEMES = [ "govbr", "rota", "alto-contraste" ] as const;
export type PanelTheme = (typeof PANEL_THEMES)[number];

const listeners = new Set<() => void>();
let memory: PanelTheme | null = null;

const isTheme = (v: unknown): v is PanelTheme =>
  typeof v === "string" && (PANEL_THEMES as readonly string[]).includes(v);

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* sessão só em memória */ }
}

export function getTheme(): PanelTheme {
  // A escolha desta sessão vale primeiro: um armazenamento que lê mas não
  // grava devolveria o valor antigo e desfaria a troca (A-06).
  if (memory) return memory;
  const saved = read(THEME_KEY);
  if (isTheme(saved)) return saved;
  return "govbr";
}

export function setTheme(theme: PanelTheme): void {
  memory = theme;
  document.documentElement.dataset.theme = theme;
  write(THEME_KEY, theme);
  listeners.forEach((l) => l());
}

export function toggleHighContrast(): void {
  const current = getTheme();
  if (current === "alto-contraste") {
    const prev = read(PREV_KEY);
    setTheme(isTheme(prev) && prev !== "alto-contraste" ? prev : "govbr");
  } else {
    write(PREV_KEY, current);
    setTheme("alto-contraste");
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

export function useTheme(): PanelTheme {
  return useSyncExternalStore(subscribe, getTheme);
}
