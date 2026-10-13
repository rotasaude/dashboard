// Lista de declarações de comparecimento já emitidas (api#59): as de um
// atendimento (no painel da declaração) ou as do dia na unidade. Só metadados
// — o api não grava trilha na lista. A recepção da unidade reimprime (o api
// grava a trilha unit_reception) e cancela com step-up, inclusive as de
// colegas; a unidade vai junto em toda chamada. Cancelada fica sem botões.
import { useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DeclarationRow } from "../../lib/api";
import { documentError } from "../../lib/clinicalDocuments";
import { fmtHourMinute } from "../../lib/format";
import { secondaryButtonStyle } from "../../components/formStyles";
import { CancelDocument } from "../documents/CancelDocument";
import { printDocument } from "../documents/printDocument";

export const ATTENDANCE_DECLARATIONS_KEY = "attendanceDeclarations";
export const UNIT_DECLARATIONS_KEY = "unitDeclarations";

const STATUS_LABEL: Record<string, string> = { issued: "emitida", cancelled: "cancelada" };

interface Props {
  rows: DeclarationRow[];
  unitId: string;
  label: string;
  showPatient?: boolean;
  onGoToSecurity?(): void;
}

export function DeclarationList({ rows, unitId, label, showPatient = false, onGoToSecurity }: Props) {
  const queryClient = useQueryClient();
  const [ cancelling, setCancelling ] = useState<DeclarationRow | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  const printingRef = useRef(false);

  function reload() {
    void queryClient.invalidateQueries({ queryKey: [ ATTENDANCE_DECLARATIONS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ UNIT_DECLARATIONS_KEY ] });
  }

  async function reprint(row: DeclarationRow) {
    if (printingRef.current) return;
    printingRef.current = true;
    setProblem(null);
    try {
      setProblem(await printDocument(row.id, documentError, unitId));
    } finally {
      printingRef.current = false;
    }
  }

  return (
    <>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <ul aria-label={label} style={list}>
        {rows.map((row) => (
          <li key={row.id} style={item}>
            <span style={{ fontSize: 12.5 }}>
              {showPatient && row.patient && <strong>{`${row.patient.display_name} · `}</strong>}
              {`${fmtHourMinute(row.issued_at)} · ${row.author.name} · ${STATUS_LABEL[row.status] ?? row.status}`}
              {row.short_code && <span className="mono" style={muted}>{` · ${row.short_code}`}</span>}
            </span>
            {row.status === "issued" && (
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => void reprint(row)}>Reimprimir</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setCancelling(row)}>Cancelar</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {cancelling && (
        <CancelDocument
          key={cancelling.id}
          doc={{ id: cancelling.id, kind: "attendance_declaration", issued_at: cancelling.issued_at }}
          healthUnitId={unitId}
          reissue={false}
          onDone={() => { setCancelling(null); reload(); }}
          onStale={(message) => { setCancelling(null); setProblem(message); reload(); }}
          onCancel={() => setCancelling(null)}
          onGoToSecurity={onGoToSecurity}
        />
      )}
    </>
  );
}

const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 };
const item: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" };
const muted: CSSProperties = { fontSize: 11, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
