// Estilos comuns das telas de exames (só papéis do tema).
import type { CSSProperties } from "react";

export const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
export const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--rule)", borderRadius: 8, background: "var(--sunken)" };
export const form: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 };
export const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
export const grid: CSSProperties = { display: "flex", gap: 24, flexWrap: "wrap" };
export const stack: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
export const fieldLabel: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
export const checkLabel: CSSProperties = { display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--ink)" };
export const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--rule)", borderRadius: 8, padding: 12 };
export const legend: CSSProperties = { fontSize: 12.5, fontWeight: 600 };
export const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
export const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
export const okText: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--ok)" };
export const list: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 12.5, display: "flex", flexDirection: "column", gap: 4 };
export const title: CSSProperties = { margin: 0, fontSize: 14 };
