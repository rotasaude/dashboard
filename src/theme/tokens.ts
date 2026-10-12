// Tokens do painel. Os valores vivem no tema (src/theme/vendor/tokens.css,
// copiado do contracts/design-tokens); aqui ficam os nomes tipados, que leem
// as variáveis do tema ativo (<html data-theme>). Escalas de tamanho, raio,
// sombra e espaço seguem as do console até o shell novo (subprojeto 2).

const v = (role: string) => `var(--${role})`;

export const tokens = {
  color: {
    bg: v("bg"), panel: v("panel"), sunken: v("sunken"), sunken2: v("sunken2"),
    rule: v("rule"), rule2: v("rule2"),
    ink: v("ink"), ink2: v("ink2"), ink3: v("ink3"), ink4: v("ink4"),

    accent: v("accent"), accentBg: v("accent-bg"),
    ok: v("ok"), okBg: v("ok-bg"),
    warn: v("warn"), warnBg: v("warn-bg"),
    down: v("down"), downBg: v("down-bg"),
    info: v("info"), infoBg: v("info-bg")
  },

  font: {
    sans: v("font-sans"),
    mono: v("font-mono")
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
    dropdown: v("shadow-dropdown"),
    notif: v("shadow-notif")
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

// Nível também por forma (WCAG 1.4.1: cor nunca é o único sinal).
// ■ alto/urgente · ▲ moderado · ● baixo/ok; demais tons não carregam nível.
export type Shape = "square" | "triangle" | "circle";

export const toneShape = (t: Tone | string | undefined): Shape | null => {
  switch (t) {
    case "down":
    case "urgent": return "square";
    case "warn":   return "triangle";
    case "ok":     return "circle";
    default:       return null;
  }
};
