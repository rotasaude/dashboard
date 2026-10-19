// Ícone da marca, decorativo, na cor do texto ao redor. A moldura de entrada
// do login o usa no rodapé e no lugar do brasão que falta.
export function BrandMark({ size }: { size: number }) {
  return (
    <svg data-brand-mark="" aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor">
      <circle cx="24" cy="24" r="18" strokeWidth="3" />
      <path d="M8 24 H16 L19 18 L24 30 L29 18 L32 24 H40" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Marca (NAVBAR.md §2), agora link para o Início.
export function Brand({ product }: { product: string }) {
  return (
    <a href="#/" aria-label={`Rota Saúde ${product} — Início`} style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, color: "var(--ink)" }}>
      <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 7, background: "var(--ink)", color: "var(--panel)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <BrandMark size={19} />
      </span>
      <span style={{ lineHeight: 1.12 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>Rota Saúde</span>
        <span className="mono" style={{ display: "block", marginTop: 1, fontSize: 10.5, color: "var(--ink3)",
          textTransform: "uppercase", letterSpacing: 0.8 }}>{product}</span>
      </span>
    </a>
  );
}
