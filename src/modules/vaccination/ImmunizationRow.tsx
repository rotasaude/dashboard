// Uma dose registrada na caderneta aberta (módulo 29; F-29.2). Só aparece dentro da caderneta (leitura nominal com trilha): o motivo
// do cancelamento é dado clínico e nunca vai a lista sem pessoa. Código de vacina que o catálogo não conhece aparece cru.
// `actions` é o espaço que a situação do envio e o ESAVI preenchem (Tasks 9 e 15). "Cancelar dose" (Task 8) só aparece com `can_cancel`
// (autor ou responsável pela sala, calculado pelo api) e dose ativa.
import type { ReactNode } from "react";
import type { Immunization } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { RndsStatusTag } from "./RndsStatusTag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { box, row } from "../exams/styles";

export interface ImmunizationRowProps {
  imm: Immunization;
  // Depois de uma ação na dose (cancelar, substituir), a tela relê a caderneta. Usado pelas Tasks 8, 9 e 15.
  onChanged(): void;
  onGoToSecurity?(): void;
  // Abre o cancelamento (CancelDose) no lugar da caderneta.
  onCancelDose?(imm: Immunization): void;
  actions?: ReactNode;
}

export function ImmunizationRow({ imm, actions, onCancelDose }: ImmunizationRowProps) {
  const cancelled = imm.status === "cancelled";
  const cancellable = !!onCancelDose && imm.can_cancel === true && imm.status === "active";
  return (
    <li style={{ ...box, listStyle: "none" }}>
      <div style={row}>
        <strong>{imm.immunobiological.name ?? imm.immunobiological.code}</strong>
        <span>{imm.dose.name ?? imm.dose.code}</span>
        {cancelled
          ? <Tag tone="down">{imm.cancel_reason ? `cancelada: ${imm.cancel_reason}` : "cancelada"}</Tag>
          : imm.status === "active" ? <Tag tone="ok">ativa</Tag> : <Tag>{imm.status}</Tag>}
        {imm.transcription && <Tag tone="info">transcrição</Tag>}
      </div>
      <div style={{ ...row, gap: 24, alignItems: "flex-start" }}>
        <KeyValue k="Aplicada em" v={fmtDateTime(imm.applied_at)} />
        <KeyValue k="Lote" v={imm.lot.number ?? "—"} />
        <KeyValue k="Sala" v={imm.room?.name ?? "—"} mono={false} />
        <KeyValue k="Quem aplicou" v={imm.by.name ?? "—"} mono={false} />
        <KeyValue k="Envio à RNDS" v={<RndsStatusTag rnds={imm.rnds} cancelled={cancelled} />} mono={false} />
      </div>
      {(actions || cancellable) && (
        <div style={row}>
          {cancellable && (
            <button type="button" style={secondaryButtonStyle} onClick={() => onCancelDose?.(imm)}>
              {`Cancelar dose — ${imm.immunobiological.name ?? imm.immunobiological.code} ${imm.dose.name ?? imm.dose.code}`}
            </button>
          )}
          {actions}
        </div>
      )}
    </li>
  );
}
