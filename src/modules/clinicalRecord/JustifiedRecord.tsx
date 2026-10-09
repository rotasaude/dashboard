// src/modules/clinicalRecord/JustifiedRecord.tsx
// Leitura com abertura justificada (módulo 19; spec §5 e §7): marcada, com a
// contagem dos 30 minutos. Quando acaba (relógio ou 403 opening_required do
// api), os dados saem da tela e do cache e a pessoa pode abrir de novo.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getConsultationOptions, getJustifiedRecord, type Opening } from "../../lib/api";
import { CONSULTATION_KEY, JUSTIFIED_KEY, OPTIONS_KEY } from "../../lib/consultation";
import { OPENING_ENDED, clinicalRecordError, countdownLabel, remainingMs } from "../../lib/clinicalRecord";
import { useAuth } from "../../lib/auth";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { PatientPanel } from "../consultation/PatientPanel";
import { ConsultationLoader } from "../consultation/ConsultationView";

interface Props { opening: Opening; onEnd(): void; searchDelayMs?: number }

export function JustifiedRecord({ opening, onEnd, searchDelayMs }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ nowMs, setNowMs ] = useState(() => Date.now());
  const [ ended, setEnded ] = useState(false);
  const [ viewing, setViewing ] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleOpeningRequired = useCallback(() => setEnded(true), []);
  const left = remainingMs(opening.expires_at, nowMs);
  const record = useQuery({
    queryKey: [ JUSTIFIED_KEY, opening.opening_id ], queryFn: () => getJustifiedRecord(opening.patient_id),
    enabled: !ended && left > 0, gcTime: 0, staleTime: 0
  });
  const options = useQuery({ queryKey: [ OPTIONS_KEY, user?.id ?? null ], queryFn: getConsultationOptions, staleTime: 5 * 60_000 });
  const over = ended || left <= 0 || (record.isError && errorCode(record.error) === "opening_required");

  useEffect(() => {
    if (!over) return;
    queryClient.removeQueries({ queryKey: [ JUSTIFIED_KEY, opening.opening_id ] });
    queryClient.removeQueries({ queryKey: [ CONSULTATION_KEY ] });
  }, [ over, queryClient, opening.opening_id ]);

  if (over) {
    return (
      <Panel title="Prontuário (abertura justificada)">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{OPENING_ENDED}</p>
          <div><button type="button" style={buttonStyle} onClick={onEnd}>Nova abertura</button></div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Prontuário (abertura justificada)" sub="leitura fora do atendimento · fica registrada"
      right={<Tag tone="warn">abertura justificada</Tag>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={countdown}>{`Abertura justificada · expira em ${countdownLabel(left)}`}</p>
        {record.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando o prontuário…</p>}
        {record.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{clinicalRecordError(record.error)}</p>}
        {record.data && (
          <>
            <PatientPanel record={record.data} onOpenConsultation={setViewing} />
            {viewing && (
              <ConsultationLoader key={viewing} id={viewing} canAddendum={() => true} openingId={opening.opening_id}
                options={options.data ?? null} patientProblems={record.data.problems} searchDelayMs={searchDelayMs}
                onClose={() => setViewing(null)} onOpeningRequired={handleOpeningRequired} />
            )}
          </>
        )}
        <div><button type="button" style={secondaryButtonStyle} onClick={onEnd}>Encerrar leitura</button></div>
      </div>
    </Panel>
  );
}

const countdown: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600, color: "var(--warn)" };
