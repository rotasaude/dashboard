// src/modules/exams/ExternalResultForm.tsx
// Resultado externo (spec §6; contrato §3): exame feito fora de um pedido do
// Rota Saúde. O exame vem do catálogo da cidade (D3), os campos são os dele,
// e a ciência fica em nome de quem registra (o api grava). Sem "crítico".
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listExamCatalog, recordExternalResult } from "../../lib/api";
import { EXAM_CATALOG_KEY, examError, refreshExams } from "../../lib/exams";
import { cityIsoDate } from "../../lib/format";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ResultForm } from "./ResultForm";
import { alert, box, fieldLabel, muted } from "./styles";

export function ExternalResultForm({ patientId, consultationId = null, onDone, onCancel }: {
  patientId: string; consultationId?: string | null; onDone(): void; onCancel(): void;
}) {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: [ EXAM_CATALOG_KEY ], queryFn: listExamCatalog, retry: false });
  const [ code, setCode ] = useState("");
  const entry = catalog.data?.find((e) => e.sigtap_code === code) ?? null;

  return (
    <section aria-label="Resultado externo" style={box}>
      <p style={muted}>Exame feito fora de um pedido do Rota Saúde. A ciência fica registrada em seu nome.</p>
      {catalog.isPending && <p className="mono" style={muted}>carregando o catálogo…</p>}
      {catalog.isError && <p role="alert" style={alert}>{examError(catalog.error)}</p>}
      {catalog.isSuccess && (
        <label style={fieldLabel}>
          Exame
          <select value={code} style={inputStyle} onChange={(e) => setCode(e.target.value)}>
            <option value="">escolha…</option>
            {catalog.data.map((e) => <option key={e.sigtap_code} value={e.sigtap_code}>{`${e.label} (${e.sigtap_code})`}</option>)}
          </select>
        </label>
      )}
      {entry ? (
        <ResultForm key={entry.sigtap_code} fields={entry.result_fields} today={cityIsoDate()} allowCritical={false}
          submitLabel="Registrar resultado externo" onCancel={onCancel}
          onSubmit={async (input) => {
            await recordExternalResult({
              patient_id: patientId, sigtap_code: entry.sigtap_code, released_on: input.released_on,
              laboratory_name: input.laboratory_name, upload_id: input.upload_id, values: input.values,
              ...(consultationId ? { consultation_id: consultationId } : {})
            });
            await refreshExams(queryClient);
            onDone();
          }} />
      ) : (
        <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button></div>
      )}
    </section>
  );
}
