// Situação do envio de uma dose à RNDS (módulo 29; F-29.4; contrato §2/§6). Rótulo e tom do código; abaixo, em texto pequeno, o motivo da
// parada (`block_reason`, código traduzido), o erro da RNDS (já limpo pelo api, sem dado pessoal; vai como TEXTO, nunca como HTML) ou,
// aceita, o dia e a hora. Transcrição e cancelamento usam o mesmo componente.
import type { ImmunizationRnds } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { blockReasonLabel, rndsStatusLabel, rndsStatusTone } from "../../lib/vaccination";
import { Tag } from "../../components/Tag";

const small = { fontSize: 11.5, color: "var(--ink3)" } as const;

// O texto abaixo do rótulo (a tabela de pendências o põe numa coluna própria).
// `cancelled`: dose cancelada. Lá `not_sent` quer dizer "nada mais vai à RNDS" (V23), não "na fila"; se a original foi aceita, diz-se.
export const CANCELLED_NOT_SENT = "não enviada (dose cancelada)";
export function rndsDetail(rnds: ImmunizationRnds, cancelled = false): string | null {
  if (cancelled && rnds.status === "not_sent") {
    return rnds.accepted_at ? `a dose original foi aceita em ${fmtDateTime(rnds.accepted_at)}` : null;
  }
  return rnds.block_reason ? blockReasonLabel(rnds.block_reason)
    : rnds.error ? `RNDS: ${rnds.error}`
    : rnds.status === "accepted" && rnds.accepted_at ? `aceita em ${fmtDateTime(rnds.accepted_at)}`
    : null;
}

export function RndsStatusTag({ rnds, cancelled = false }: { rnds: ImmunizationRnds; cancelled?: boolean }) {
  const detail = rndsDetail(rnds, cancelled);
  const notSent = cancelled && rnds.status === "not_sent";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <Tag tone={notSent ? "neutral" : rndsStatusTone(rnds.status)}>{notSent ? CANCELLED_NOT_SENT : rndsStatusLabel(rnds.status)}</Tag>
      {detail && <small style={small}>{detail}</small>}
    </span>
  );
}
