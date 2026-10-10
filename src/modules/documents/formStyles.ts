// Estilos repetidos dos formulários de documento (módulo 19c). Os botões e
// campos são os de src/components/formStyles.ts; aqui só a moldura e textos.
import type { CSSProperties } from "react";

export const formBox: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
export const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
export const checkLabel: CSSProperties = { display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--ink2)" };
export const rowStyle: CSSProperties = { display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" };
export const alertStyle: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
export const mutedStyle: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
export const linkButton: CSSProperties = {
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 12, color: "var(--accent)", textDecoration: "underline"
};
