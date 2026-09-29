// src/modules/campaigns/styles.ts
// Estilos das telas de campanha (mesma linguagem de Territory e Team).
import type { CSSProperties } from "react";

export const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
export const alertStyle: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
export const noteStyle: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
export const warnStyle: CSSProperties = {
  margin: 0, padding: "8px 10px", fontSize: 13, fontWeight: 600, color: "var(--warn)",
  border: "1px solid var(--warn)", borderRadius: 6
};
export const cardStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 10, padding: 12,
  border: "1px solid var(--rule)", borderRadius: 8, background: "var(--panel)"
};
export const fieldsetStyle: CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: 10, margin: 0, padding: "8px 10px",
  border: "1px solid var(--rule)", borderRadius: 6
};
export const legendStyle: CSSProperties = { fontSize: 12, color: "var(--ink2)", padding: "0 4px" };
export const checkStyle: CSSProperties = { display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 };
export const rowStyle: CSSProperties = { display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" };
export const columnStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
