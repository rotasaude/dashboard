// A senha para entregar à pessoa (módulo 32a, F-32.2; contrato §4 e §8). A senha só vem com `waiting_room_display` ligado; sem ela,
// só a frase da chegada. Nada de nome, documento ou descrição aqui: o cartão fica à vista no balcão. O foco vai ao título ao aparecer.
import { useEffect, useRef } from "react";
import { buttonStyle } from "../../components/formStyles";

export const HAND_OVER_TEXT = "Entregue a senha à pessoa: ela será chamada por ela na TV.";
export const ARRIVED_TEXT = "Chegada registrada. A pessoa aguarda a classificação de risco.";

export function TicketCard({ ticket, unitName, onDone }: { ticket: string | null; unitName: string; onDone(): void }) {
  const titleRef = useRef<HTMLHeadingElement & HTMLParagraphElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      {ticket ? (
        <>
          <h2 ref={titleRef} tabIndex={-1}
            style={{ margin: 0, fontSize: 44, lineHeight: 1.1, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
            Senha {ticket}
          </h2>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{unitName}</p>
          <p style={{ margin: 0, fontSize: 13.5 }}>{HAND_OVER_TEXT}</p>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{ARRIVED_TEXT}</p>
        </>
      ) : (
        <p ref={titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{ARRIVED_TEXT}</p>
      )}
      <button type="button" style={buttonStyle} onClick={onDone}>Próxima chegada</button>
    </div>
  );
}
