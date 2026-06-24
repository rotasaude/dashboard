import { useEffect, useState } from "react";

type Health =
  | { kind: "loading" }
  | { kind: "ok"; status: number }
  | { kind: "error"; detail: string };

export function App() {
  const [health, setHealth] = useState<Health>({ kind: "loading" });

  useEffect(() => {
    fetch("/up")
      .then((res) => setHealth({ kind: "ok", status: res.status }))
      .catch((err) => setHealth({ kind: "error", detail: String(err) }));
  }, []);

  return (
    <main style={{ fontFamily: "var(--font-mono, monospace)", padding: 24 }}>
      <h1>Rota Saúde · Dashboard</h1>
      <p>Painel operacional da cidade (tenant-scoped). Fundação — sem painéis ainda.</p>
      <HealthLine health={health} />
    </main>
  );
}

function HealthLine({ health }: { health: Health }) {
  if (health.kind === "loading") return <p>API: verificando…</p>;
  if (health.kind === "ok") return <p>API /up: {health.status} ✓ (proxy dev→Rails ok)</p>;
  return <p>API /up: falhou — {health.detail}</p>;
}
