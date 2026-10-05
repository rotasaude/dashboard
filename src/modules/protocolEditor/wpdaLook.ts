// src/modules/protocolEditor/wpdaLook.ts
import type { CSSProperties } from "react";

// Medidas do canal do cidadão, copiadas de apps/wpda/src/modules/citizen/ui.tsx
// (Screen, BigButton, Field): texto de 18 px, alvos de 56 px, cantos de 12 px.
// As cores são as variáveis CSS que o dashboard e o wpda definem com os mesmos
// valores (theme/tokens.ts e theme/global.css dos dois apps). O
// contracts/design-tokens ainda é só um README; nada aqui importa código do wpda.
export const WPDA: Record<string, CSSProperties> = {
  screen: {
    maxWidth: 360, padding: 16, border: "1px solid var(--rule2)", borderRadius: 16, background: "var(--panel)",
    fontFamily: "system-ui, sans-serif", fontSize: 18, color: "var(--ink)"
  },
  brand: { fontSize: 14, color: "var(--ink3)" },
  title: { fontSize: 24, margin: "4px 0 16px" },
  counter: { margin: "0 0 8px", color: "var(--ink2)" },
  progress: { width: "100%", height: 8, marginBottom: 16 },
  button: { minHeight: 56, width: "100%", borderRadius: 12, fontSize: 18, fontWeight: 600, cursor: "default" },
  primary: { background: "var(--accent)", color: "#fff", border: "none" },
  secondary: { background: "transparent", color: "var(--ink)", border: "1px solid var(--rule2)" },
  field: { minHeight: 56, fontSize: 20, padding: "0 12px", borderRadius: 12, border: "1px solid var(--rule2)" },
  footer: { fontSize: 14, color: "var(--ink3)", textAlign: "center" }
};
