// Declaração de comparecimento pela recepção (módulo 19c; spec §4 e §7
// "Recepção"; contrato §3): pelo atendimento, com a hora de chegada do
// check-in já preenchida. Quem não é profissional informa a matrícula (sai no
// papel); o profissional emite com o próprio CBO e conselho. Sai em papel (a
// recepção não assina); o api recusa atendimento de mais de 30 dias. O painel
// guarda a linha escolhida: a pessoa pode sair da fila enquanto a recepção
// preenche, e a declaração ainda sai. api#59: a declaração é da unidade do
// seletor, e o painel lista as já emitidas no atendimento (reimprimir/cancelar).
import { useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { issueAttendanceDeclaration, listAttendanceDeclarations, type ClinicalDocument, type QueueRow } from "../../lib/api";
import { documentError, emptyDeclaration, issuedNotice } from "../../lib/clinicalDocuments";
import { todayInCity } from "../../lib/campaigns";
import { fmtHourMinute } from "../../lib/format";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { DeclarationForm } from "../documents/DeclarationForm";
import { printDocument } from "../documents/printDocument";
import { useReveal } from "../../lib/useReveal";
import { ATTENDANCE_DECLARATIONS_KEY, DeclarationList } from "./DeclarationList";

interface Props {
  row: QueueRow;
  unitId: string;
  onClose(): void;
  onGoToSecurity?(): void;
  // Profissional emite com o próprio CBO e conselho: não pede matrícula.
  professional?: boolean;
}

export function DeclarationPanel({ row, unitId, onClose, onGoToSecurity, professional = false }: Props) {
  const queryClient = useQueryClient();
  const declarationsKey = [ ATTENDANCE_DECLARATIONS_KEY, row.id, unitId ];
  const declarations = useQuery({ queryKey: declarationsKey, queryFn: () => listAttendanceDeclarations(row.id, unitId) });
  const [ issued, setIssued ] = useState<ClinicalDocument | null>(null);
  const [ issuing, setIssuing ] = useState(false);
  const issuingRef = useRef(false);
  const [ printing, setPrinting ] = useState(false);
  const printingRef = useRef(false);
  const [ printError, setPrintError ] = useState<string | null>(null);
  const [ initial ] = useState(() => emptyDeclaration(todayInCity(), fmtHourMinute(row.checked_in_at)));

  async function issue(content: Parameters<typeof issueAttendanceDeclaration>[1]) {
    if (issuingRef.current) return;
    issuingRef.current = true;
    setIssuing(true);
    try {
      setIssued(await issueAttendanceDeclaration(row.id, content, unitId));
      void queryClient.invalidateQueries({ queryKey: declarationsKey });
    } finally {
      issuingRef.current = false;
      setIssuing(false);
    }
  }

  async function print(doc: ClinicalDocument) {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(true); setPrintError(null);
    try {
      const problem = await printDocument(doc.id, documentError, unitId);
      if (problem) setPrintError(problem);
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }

  // Abre à vista e fecha com Escape (FC-13).
  const revealRef = useReveal<HTMLElement>(true);

  return (
    <section ref={revealRef} aria-label="Declaração de comparecimento do atendimento" style={panel}
      onKeyDown={(e) => { if (e.key === "Escape" && !issuing) onClose(); }}>
      <p className="mono" style={muted}>{`${row.display_name ?? row.cpf_masked} · chegou às ${fmtHourMinute(row.checked_in_at)}`}</p>
      {issued ? (
        <>
          <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{issuedNotice(issued)}</p>
          <p style={muted}>Código de conferência: <span className="mono">{issued.short_code}</span></p>
          {printError && <p role="alert" style={alert}>{printError}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={printing} style={printing ? disabledButtonStyle : buttonStyle} onClick={() => void print(issued)}>
              Imprimir
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
          </div>
        </>
      ) : (
        <DeclarationForm initial={initial} showIssuerRegistration={!professional} busy={issuing}
          onCancel={onClose} onSubmit={issue} />
      )}
      {declarations.isError && <p role="alert" style={alert}>{documentError(declarations.error)}</p>}
      {declarations.data && declarations.data.length > 0 && (
        <>
          <p style={{ ...muted, fontWeight: 600 }}>Já emitidas neste atendimento</p>
          <DeclarationList rows={declarations.data} unitId={unitId} label="Declarações deste atendimento" onGoToSecurity={onGoToSecurity} />
        </>
      )}
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const muted: CSSProperties = { margin: 0, fontSize: 11, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
