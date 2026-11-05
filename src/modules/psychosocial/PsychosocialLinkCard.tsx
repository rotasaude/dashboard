// Cartão do vínculo com o CAPS na tela do paciente da UBS (F-31.7, F-31.2; §7, P10, P44, P46, P48): "Em acompanhamento no CAPS
// desde …", o técnico de referência e o telefone do CAPS, e os casos compartilhados no matriciamento com a equipe de quem lê — também
// depois da alta. Genérico (P46): nunca o nome, o id nem a modalidade do CAPS; o cartão lê só os campos do contrato e nunca espalha a
// resposta. Fora do contexto, sem o papel ou com o interruptor desligado (P44), o cartão some sem frase: nenhum desses casos pode
// dizer se o paciente tem vínculo. Leitura nominal (`NOMINAL_QUERY`, chave por paciente); a trilha, quando há caso, é do api.
// Sem matrícula e com `canRefer`, "Encaminhar ao CAPS" abre o `ReferralForm`; o sucesso diz só "o CAPS" (R19).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPsyLink, type PsySharedCase } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import {
  LINK_CASES_TITLE, LINK_TITLE, NOMINAL_QUERY, PSY_DETAIL_KEY, REFERRAL_SENT, REFER_BUTTON, linkHidden, linkReferenceText, linkSinceText, psyError
} from "../../lib/psychosocial";
import { secondaryButtonStyle } from "../../components/formStyles";
import { list, muted, okText } from "../exams/styles";
import { ReferralForm } from "./ReferralForm";

type LinkView = { since: string | null; reference: string | null; phone: string | null; cases: PsySharedCase[] };

// Só os campos do contrato; qualquer outro (nome do CAPS, CID, PTS) fica fora, mesmo que o api mande por engano.
function viewOf(data: unknown): LinkView {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const field = (o: unknown, key: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined);
  const cases = (Array.isArray(d.shared_cases) ? d.shared_cases : []).flatMap((c): PsySharedCase[] => {
    const heldOn = str(field(c, "held_on"));
    const text = str(field(c, "shared_text"));
    return heldOn && text ? [ { held_on: heldOn, shared_text: text } ] : [];
  });
  const enrolled = d.enrolled === true;
  return {
    since: enrolled ? str(d.since) : null, reference: enrolled ? str(field(d.reference, "name")) : null,
    phone: enrolled ? str(field(d.caps, "phone")) : null, cases
  };
}

export function PsychosocialLinkCard({ patientId, canRefer }: { patientId: string; canRefer: boolean }) {
  const link = useQuery({ queryKey: [ PSY_DETAIL_KEY, "link", patientId ], queryFn: () => getPsyLink(patientId), ...NOMINAL_QUERY });
  const [ referring, setReferring ] = useState(false);
  const [ sent, setSent ] = useState(false);
  const sentRef = useRef<HTMLParagraphElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  useEffect(() => { if (sent) sentRef.current?.focus(); }, [ sent ]);
  useEffect(() => {
    if (referring || !returnFocus.current) return;
    returnFocus.current = false;
    buttonRef.current?.focus();
  }, [ referring ]);

  if (link.isPending) return null;
  if (link.isError) {
    if (linkHidden(link.error)) return null;
    return (
      <div style={block}>
        <strong style={sub}>{LINK_TITLE}</strong>
        <p style={muted}>{psyError(link.error)}</p>
      </div>
    );
  }
  const v = viewOf(link.data);
  const enrolled = link.data.enrolled === true;
  const offerReferral = canRefer && !enrolled;
  if (!enrolled && v.cases.length === 0 && !offerReferral) return null;

  return (
    <div style={block}>
      <strong style={sub}>{LINK_TITLE}</strong>
      {enrolled && v.since && <p style={text}>{linkSinceText(v.since)}</p>}
      {enrolled && v.reference && <p style={text}>{linkReferenceText(v.reference, v.phone)}</p>}
      {v.cases.length > 0 && (
        <>
          <span style={sub}>{LINK_CASES_TITLE}</span>
          <ul aria-label={LINK_CASES_TITLE} style={list}>
            {v.cases.map((c, i) => (
              <li key={`${c.held_on}-${i}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{fmtDay(c.held_on)}</span>
                <span style={{ whiteSpace: "pre-wrap" }}>{c.shared_text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {sent && <p ref={sentRef} tabIndex={-1} role="status" style={okText}>{REFERRAL_SENT}</p>}
      {offerReferral && (referring ? (
        <ReferralForm patientId={patientId} onSent={() => { setReferring(false); setSent(true); }}
          onCancel={() => { returnFocus.current = true; setReferring(false); }} />
      ) : (
        <div>
          <button ref={buttonRef} type="button" style={secondaryButtonStyle} onClick={() => { setSent(false); setReferring(true); }}>{REFER_BUTTON}</button>
        </div>
      ))}
    </div>
  );
}

const block: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const sub: CSSProperties = { fontSize: 12.5 };
const text: CSSProperties = { margin: 0, fontSize: 12.5 };
