// Skeleton — shimmer simples para estado de loading.

interface Props {
  rows?: number;
  height?: number;
}

export function Skeleton({ rows = 3, height = 14 }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height,
            borderRadius: 6,
            background:
              "linear-gradient(90deg, var(--sunken) 0px, var(--sunken2) 60px, var(--sunken) 120px)",
            backgroundSize: "200px 100%",
            animation: "skeleton-shimmer 1.4s ease-in-out infinite"
          }}
        />
      ))}
    </div>
  );
}
