// Design tokens do Admin Console.
// Fonte: DESIGN_TOKENS.md + console-ui.jsx (objeto AT). Estética: console
// técnico sóbrio, neutros frios (oklch). Valores expostos como CSS vars
// em theme/global.css para uso runtime; este módulo é o ground truth tipado.

export const tokens = {
  color: {
    bg:      "oklch(98.4% 0.002 255)",
    panel:   "oklch(100% 0 0)",
    sunken:  "oklch(96.6% 0.003 255)",
    sunken2: "oklch(94.6% 0.004 255)",
    rule:    "oklch(91.5% 0.004 255)",
    rule2:   "oklch(86% 0.005 255)",
    ink:     "oklch(26% 0.01 260)",
    ink2:    "oklch(46% 0.009 260)",
    ink3:    "oklch(61% 0.007 260)",
    ink4:    "oklch(72% 0.006 260)",

    accent:   "oklch(52% 0.14 264)",
    accentBg: "oklch(95.5% 0.025 264)",
    ok:       "oklch(56% 0.11 155)",
    okBg:     "oklch(95% 0.04 155)",
    warn:     "oklch(64% 0.13 65)",
    warnBg:   "oklch(95.5% 0.045 75)",
    down:     "oklch(55% 0.18 27)",
    downBg:   "oklch(95.5% 0.05 27)",
    info:     "oklch(55% 0.11 245)",
    infoBg:   "oklch(95.5% 0.03 245)"
  },

  font: {
    sans: `"Geist Variable", "Geist", -apple-system, "Segoe UI", Roboto, sans-serif`,
    mono: `"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace`
  },

  size: {
    kpiValue: 27,
    h1: 20,
    kvValue: 14,
    panelTitle: 13.5,
    sectionTitle: 13,
    nav: 12.5,
    cell: 12,
    kpiLabel: 11.5,
    aux: 11,
    badge: 10.5
  },

  radius: {
    panel: 10,
    menu: 12,
    chip: 6,
    pill: 999
  },

  shadow: {
    dropdown: "0 8px 28px -8px rgba(20,20,40,.22), 0 2px 6px rgba(20,20,40,.06)",
    notif:    "0 14px 40px -10px rgba(20,20,40,.26), 0 3px 8px rgba(20,20,40,.07)"
  },

  space: {
    panelGap: 16,
    panelPad: 16,
    panelHeadPad: "13px 16px",
    contentPad: "22px 32px 48px"
  }
} as const;

// Mapeamento de tone → cor semântica + bg.
export type Tone = "ok" | "warn" | "down" | "info" | "accent" | "neutral" | "urgent";

export const toneColor = (t: Tone | string | undefined): { fg: string; bg: string } => {
  switch (t) {
    case "ok":      return { fg: tokens.color.ok,     bg: tokens.color.okBg };
    case "warn":    return { fg: tokens.color.warn,   bg: tokens.color.warnBg };
    case "down":
    case "urgent":  return { fg: tokens.color.down,   bg: tokens.color.downBg };
    case "info":    return { fg: tokens.color.info,   bg: tokens.color.infoBg };
    case "accent":  return { fg: tokens.color.accent, bg: tokens.color.accentBg };
    default:        return { fg: tokens.color.ink3,   bg: tokens.color.sunken };
  }
};
