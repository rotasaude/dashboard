// src/modules/clinicalRecord/JustifiedTimeline.tsx
// Linha do tempo pela abertura justificada, sem o prontuário (módulo 20;
// spec §5 e §8): no modo integrated a cidade não tem prontuário no Rota
// Saúde, mas a pessoa tem linha do tempo. Mesmas regras da abertura do 19a:
// marcada, 30 minutos, e quando acaba (relógio ou 403 do api) os dados saem
// da tela e do cache.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Opening } from "../../lib/api";
import { OPENING_ENDED, countdownLabel, deadlineMs } from "../../lib/clinicalRecord";
import { CONSULTATION_KEY } from "../../lib/consultation";
import { TIMELINE_KEY } from "../../lib/timeline";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { PatientTimeline } from "../timeline/PatientTimeline";

interface Props { opening: Opening; onEnd(): void; searchDelayMs?: number }

export function JustifiedTimeline({ opening, onEnd, searchDelayMs }: Props) {
  const queryClient = useQueryClient();
  const [ receivedAt ] = useState(() => Date.now());
  const [ nowMs, setNowMs ] = useState(receivedAt);
  const [ ended, setEnded ] = useState(false);

  const left = Math.max(0, deadlineMs(opening.expires_at, receivedAt) - nowMs);
  const over = ended || left <= 0;

  useEffect(() => {
    if (over) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ over ]);

  const end = useCallback(() => setEnded(true), []);

  useEffect(() => {
    if (!over) return;
    queryClient.removeQueries({ queryKey: [ TIMELINE_KEY ] });
    queryClient.removeQueries({ queryKey: [ CONSULTATION_KEY ] });
  }, [ over, queryClient ]);

  if (over) {
    return (
      <Panel title="Linha do tempo (abertura justificada)">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{OPENING_ENDED}</p>
          <div><button type="button" style={buttonStyle} onClick={onEnd}>Nova abertura</button></div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Linha do tempo (abertura justificada)" sub="leitura fora do atendimento · fica registrada"
      right={<Tag tone="warn">abertura justificada</Tag>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={countdown}>{`Abertura justificada · expira em ${countdownLabel(left)}`}</p>
        <PatientTimeline subject={{ openingId: opening.opening_id }} endOnOutOfContext onOpeningRequired={end} searchDelayMs={searchDelayMs} />
        <div><button type="button" style={secondaryButtonStyle} onClick={onEnd}>Encerrar leitura</button></div>
      </div>
    </Panel>
  );
}

const countdown: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600, color: "var(--warn)" };
