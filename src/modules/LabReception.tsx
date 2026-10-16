// src/modules/LabReception.tsx
// Recebimento (spec §5.4; contrato §4): escolha a decisão e leia a etiqueta.
// Rejeição exige o motivo do cadastro e gera a recoleta na UBS de origem; a
// restrição vai ao laudo. A decisão vale para as leituras seguintes até ser
// trocada; enquanto há leitura na fila ela fica travada (rejeitar não desfaz,
// então uma leitura já feita não pode pegar a decisão trocada depois).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listActiveRejectionReasons, receiveSample, type LabReceiveDecision } from "../lib/api";
import { LAB_REASONS_KEY, labError, refreshLab } from "../lib/lab";
import { Panel } from "../components/Panel";
import { inputStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabScope } from "./lab/LabScope";
import { ScanField, type ScanOutcome } from "./lab/ScanField";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, stack } from "./exams/styles";

const DECISIONS: { value: LabReceiveDecision; label: string }[] = [
  { value: "accept", label: "Aceitar" }, { value: "reject", label: "Rejeitar" }, { value: "accept_with_restriction", label: "Aceitar com restrição" }
];

export function LabReception() {
  return (
    <LabGate title="Recebimento de amostras" sub="laboratório municipal · aceitar, rejeitar ou aceitar com restrição" allow={(r) => r.staff}>
      {(roles) => <LabScope roles={roles}>{(scope) => <ReceptionBody key={scope.providerId} providerId={scope.providerId} />}</LabScope>}
    </LabGate>
  );
}

function ReceptionBody({ providerId }: { providerId: string }) {
  const queryClient = useQueryClient();
  const reasons = useQuery({ queryKey: [ LAB_REASONS_KEY, providerId ], queryFn: () => listActiveRejectionReasons(providerId), retry: false });
  const [ decision, setDecision ] = useState<LabReceiveDecision>("accept");
  const [ reasonId, setReasonId ] = useState("");
  const [ note, setNote ] = useState("");
  const [ scanning, setScanning ] = useState(false);

  // A escolha é lida quando a leitura entra na fila (capture), não quando é gravada.
  interface Choice { d: LabReceiveDecision; reason: string; restriction: string }
  const receive = async (code: string, choice: Choice | undefined): Promise<ScanOutcome> => {
    const { d, reason, restriction } = choice ?? { d: "accept" as const, reason: "", restriction: "" };
    if (d === "reject" && !reason) return { ok: false, text: "escolha o motivo da rejeição antes de ler" };
    if (d === "accept_with_restriction" && !restriction.trim()) return { ok: false, text: "escreva a restrição antes de ler" };
    try {
      const out = await receiveSample({
        barcode: code, decision: d,
        ...(d === "reject" ? { reason_id: reason } : {}),
        ...(d === "accept_with_restriction" ? { restriction_note: restriction.trim() } : {})
      });
      // o recebimento já foi gravado: falha ao reler as listas não o desfaz
      void Promise.resolve().then(() => refreshLab(queryClient)).catch(() => undefined);
      if (d === "reject") {
        return { ok: true, text: `rejeitada${out.recollection ? ` · recoleta ${out.recollection.barcode} pedida à UBS de origem` : ""}` };
      }
      return { ok: true, text: `${d === "accept" ? "aceita" : "aceita com restrição"} · requisição ${out.sample.requisition_number}` };
    } catch (err) {
      if (errorCode(err) === "invalid_transition") return { ok: false, text: "esta amostra já foi recebida, rejeitada ou ainda não foi coletada" };
      return { ok: false, text: labError(err) };
    }
  };

  return (
    <Panel title="Receber" sub="a decisão escolhida vale para as próximas leituras">
      <div style={stack}>
        <fieldset style={fieldset}>
          <legend style={legend}>Decisão</legend>
          {DECISIONS.map((d) => (
            <label key={d.value} style={checkLabel}>
              <input type="radio" name="decision" checked={decision === d.value} disabled={scanning} onChange={() => setDecision(d.value)} />{d.label}
            </label>
          ))}
        </fieldset>
        {decision === "reject" && (
          <>
            <label style={fieldLabel}>
              Motivo da rejeição
              <select value={reasonId} style={inputStyle} disabled={scanning} onChange={(e) => setReasonId(e.target.value)}>
                <option value="">—</option>
                {(reasons.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <p role="alert" style={alert}>A próxima etiqueta lida será rejeitada e a recoleta é pedida à UBS de origem. Não dá para desfazer.</p>
            {reasons.data?.length === 0 && <p style={muted}>nenhum motivo de rejeição ativo neste laboratório — o administrador cadastra em Exames</p>}
          </>
        )}
        {reasons.isError && <p role="alert" style={alert}>{labError(reasons.error)}</p>}
        {decision === "accept_with_restriction" && (
          <label style={fieldLabel}>
            Restrição (vai ao laudo)
            <input value={note} style={inputStyle} disabled={scanning} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        <ScanField label="Etiqueta do tubo" onScan={receive} onBusyChange={setScanning}
          capture={() => ({ d: decision, reason: reasonId, restriction: note })}
          onQueued={() => {
            // uma rejeição ou restrição por escolha explícita: a próxima leitura já volta a aceitar
            const valid = decision === "reject" ? reasonId !== "" : decision === "accept_with_restriction" && note.trim() !== "";
            if (valid) { setDecision("accept"); setReasonId(""); setNote(""); }
          }} />
      </div>
    </Panel>
  );
}
