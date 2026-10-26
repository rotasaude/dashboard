// src/modules/territory/Reveal.tsx
// Peça que abre fora da tela (no celular, o detalhe do domicílio, a ficha na
// Validade e os blocos de edição abrem acima ou abaixo de onde se tocou): ao
// montar, rola até o título da peça e põe o foco nele (tabIndex -1), como o
// índice da recepção. O título é o primeiro h2/strong dentro; `key` no uso
// faz uma peça nova revelar de novo.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export function Reveal({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const title = ref.current?.querySelector<HTMLElement>("h2, strong");
    if (!title) return;
    title.tabIndex = -1;
    if (typeof title.scrollIntoView === "function") title.scrollIntoView({ block: "start" });
    title.focus();
  }, []);
  return <div ref={ref} style={style}>{children}</div>;
}
