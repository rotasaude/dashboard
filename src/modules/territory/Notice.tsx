// src/modules/territory/Notice.tsx
// Mensagem de sucesso depois de salvar (PROVA-4): a ficha ou a linha que
// tinha o foco some, e o foco cairia no body. A mensagem recebe o foco ao
// aparecer (tabIndex -1), como o título das peças reveladas (Reveal); quem
// usa a desmonta antes de cada ação (notice null), então cada gravação foca de novo.
import { useEffect, useRef } from "react";
import { okText } from "../exams/styles";

export function Notice({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [ text ]);
  return <p ref={ref} role="status" tabIndex={-1} style={okText}>{text}</p>;
}
