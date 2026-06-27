// Cabeçalho de página: título 20px + slug mono.

interface Props {
  title: string;
  sub: string;
}

export function PageHeader({ title, sub }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{title}</h1>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink3)",
          textTransform: "uppercase",
          letterSpacing: 0.6
        }}
      >
        {sub}
      </span>
    </div>
  );
}
