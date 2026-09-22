import type { CSSProperties } from "react";

// Estilos de formulário do dashboard, os mesmos de Login.tsx — extraídos
// para as telas de ação sensível não copiarem os literais.
export const inputStyle: CSSProperties = {
  width: "100%", padding: 8, marginTop: 4, borderRadius: 6,
  border: "1px solid var(--line, #ccc)"
};
export const buttonStyle: CSSProperties = {
  padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer",
  background: "var(--accent, #2b59ff)", color: "#fff", fontSize: 13
};
export const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle, background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--rule2)"
};
// Um botão `disabled` some visualmente se só o atributo HTML fizer o
// trabalho — aplique junto de `disabled` sempre que um botão puder estar
// desabilitado (ação bloqueada, ou ação em voo).
export const disabledButtonStyle: CSSProperties = {
  ...buttonStyle, opacity: 0.55, cursor: "not-allowed"
};
