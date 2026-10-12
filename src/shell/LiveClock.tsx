// Relógio "ao vivo" (NAVBAR.md §4.5), extraído do AppHeader. Só aparece a
// partir de 1280px (classe shell-clock em shell.css).
import { useEffect, useState } from "react";
import { cityDateFormat, cityOffsetLabel } from "../lib/format";

export function LiveClock() {
  const [ time, setTime ] = useState(() => formatNow());
  useEffect(() => {
    const id = setInterval(() => setTime(formatNow()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="shell-clock"
      style={{
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        background: "var(--sunken)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        flexShrink: 0
      }}
      aria-live="off"
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "var(--ok)",
          color: "var(--ok)",
          animation: "pulse-dot 1.6s ease-in-out infinite",
          flexShrink: 0
        }}
      />
      <span className="mono" style={{ fontSize: 11, color: "var(--ink3)", whiteSpace: "nowrap" }}>
        {time} <span style={{ color: "var(--ink3)" }}>{cityOffsetLabel()}</span>
      </span>
    </span>
  );
}

function formatNow(): string {
  return cityDateFormat({ hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
}
