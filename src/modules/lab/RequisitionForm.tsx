// src/modules/lab/RequisitionForm.tsx
// Requisição do laboratório (spec §5.1; contrato §4). Junta os exames do 21a
// do paciente para o laboratório (candidatos) e o pedido em papel (vira
// exame `lab_reception` no api). A UBS que coleta abre com a própria unidade
// e `collection_place: ubs`; a recepção do laboratório escolhe a unidade de
// origem e coleta no posto (`lab`). Nome da mãe e sexo identificam a amostra
// e escolhem a referência; vão só no corpo.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createLabRequisition, errorCode, listActiveUnits, listExamRequesters, listLabCandidates, listLabExams,
  type ExamPatient, type HealthUnit, type LabRequisition
} from "../../lib/api";
import {
  COLLECTION_PLACE_LABEL, EMPTY_PAPER, EMPTY_REQUISITION, LAB_CANDIDATES_KEY, LAB_EXAMS_KEY, SEX_OPTIONS, labError,
  requisitionBody, requisitionProblem, type PaperDraft, type RequisitionDraft
} from "../../lib/lab";
import { PRIORITY_LABEL } from "../../lib/exams";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { PatientLookup } from "../exams/PatientLookup";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export function RequisitionForm({ place, providerId, originUnit, onDone, onCancel }: {
  place: "ubs" | "lab"; providerId: string; originUnit: HealthUnit | null; onDone(r: LabRequisition): void; onCancel(): void;
}) {
  const queryClient = useQueryClient();
  const [ patient, setPatient ] = useState<ExamPatient | null>(null);
  const [ unitId, setUnitId ] = useState(originUnit?.id ?? "");
  const [ draft, setDraft ] = useState<RequisitionDraft>(EMPTY_REQUISITION);
  const [ error, setError ] = useState<string | null>(null);
  const set = (patch: Partial<RequisitionDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits, enabled: place === "lab", retry: false });
  const candidates = useQuery({
    queryKey: [ LAB_CANDIDATES_KEY, patient?.id ?? null, providerId ], queryFn: () => listLabCandidates(patient?.id as string, providerId),
    enabled: !!patient, gcTime: 0, staleTime: 0, retry: false
  });
  const exams = useQuery({ queryKey: [ LAB_EXAMS_KEY, providerId ], queryFn: () => listLabExams(providerId), retry: false });
  const requesters = useQuery({
    queryKey: [ "examRequesters", unitId ], queryFn: () => listExamRequesters(unitId), enabled: !!unitId && draft.paper.length > 0, retry: false
  });

  function setPaper(i: number, patch: Partial<PaperDraft>) {
    set({ paper: draft.paper.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  }

  function toggleOrder(id: string, on: boolean) {
    set({ orderIds: on ? [ ...draft.orderIds, id ] : draft.orderIds.filter((x) => x !== id) });
  }

  async function submit() {
    if (!unitId) { setError("escolha a unidade de origem"); return; }
    const problem = requisitionProblem({ ...draft, patientId: patient?.id ?? null });
    if (problem) { setError(problem); return; }
    setError(null);
    try {
      const created = await createLabRequisition(requisitionBody({ ...draft, patientId: patient?.id ?? null }, { providerId, originUnitId: unitId, place }));
      onDone(created);
    } catch (err) {
      setError(labError(err));
      if (errorCode(err) === "order_not_eligible") {
        set({ orderIds: [] });
        await queryClient.invalidateQueries({ queryKey: [ LAB_CANDIDATES_KEY ] });
      }
    }
  }

  return (
    <section aria-label="Nova requisição" style={form}>
      <p style={muted}>{`Coleta ${COLLECTION_PLACE_LABEL[place]}${originUnit ? ` · ${originUnit.name}` : ""}`}</p>
      {place === "lab" && (
        <label style={fieldLabel}>
          Unidade de origem
          <select value={unitId} style={inputStyle} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">—</option>
            {(units.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      <PatientLookup patient={patient} onFound={(p) => { setPatient(p); set({ orderIds: [] }); }} />
      {patient && (
        <>
          <label style={fieldLabel}>
            Sexo biológico
            <select value={draft.biologicalSex} style={inputStyle} onChange={(e) => set({ biologicalSex: e.target.value as RequisitionDraft["biologicalSex"] })}>
              <option value="">—</option>
              {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Nome da mãe
            <input value={draft.motherName} autoComplete="off" style={inputStyle} onChange={(e) => set({ motherName: e.target.value })} />
          </label>
          <label style={checkLabel}>
            <input type="checkbox" checked={draft.urgent} onChange={(e) => set({ urgent: e.target.checked })} />Urgente
          </label>
          <label style={fieldLabel}>
            Informação clínica (opcional)
            <textarea value={draft.clinicalInfo} rows={2} style={inputStyle} onChange={(e) => set({ clinicalInfo: e.target.value })} />
          </label>

          <fieldset style={fieldset}>
            <legend style={legend}>Exames pedidos no Rota Saúde</legend>
            {candidates.isPending && <p className="mono" style={muted}>carregando…</p>}
            {candidates.isError && <p role="alert" style={alert}>{labError(candidates.error)}</p>}
            {candidates.isSuccess && candidates.data.length === 0 && (
              <p style={muted}>nenhum exame do paciente aguardando este laboratório — use o pedido em papel</p>
            )}
            {candidates.data?.map((c) => (
              <label key={c.id} style={checkLabel}>
                <input type="checkbox" checked={draft.orderIds.includes(c.id)} onChange={(e) => toggleOrder(c.id, e.target.checked)} />
                {`${c.label} · ${c.short_code} · ${PRIORITY_LABEL[c.priority] ?? c.priority} · ${c.requester_name}`}
              </label>
            ))}
          </fieldset>

          {draft.paper.map((p, i) => (
            <fieldset key={i} role="group" aria-label={`Pedido em papel ${i + 1}`} style={fieldset}>
              <legend style={legend}>{`Pedido em papel ${i + 1}`}</legend>
              <label style={fieldLabel}>
                Exame
                <select value={p.sigtapCode} style={inputStyle} onChange={(e) => setPaper(i, { sigtapCode: e.target.value })}>
                  <option value="">—</option>
                  {(exams.data ?? []).map((x) => <option key={x.sigtap_code} value={x.sigtap_code}>{`${x.name} (${x.material})`}</option>)}
                </select>
              </label>
              <div style={row}>
                <label style={checkLabel}>
                  <input type="radio" name={`requester-${i}`} checked={p.mode === "linked"} onChange={() => setPaper(i, { mode: "linked" })} />
                  Profissional da rede
                </label>
                <label style={checkLabel}>
                  <input type="radio" name={`requester-${i}`} checked={p.mode === "typed"} onChange={() => setPaper(i, { mode: "typed" })} />
                  Digitar quem pediu
                </label>
              </div>
              {p.mode === "linked" ? (
                <label style={fieldLabel}>
                  Quem pediu
                  <select value={p.userId} style={inputStyle} onChange={(e) => setPaper(i, { userId: e.target.value })}>
                    <option value="">—</option>
                    {(requesters.data ?? []).map((r) => <option key={r.user_id} value={r.user_id}>{r.name}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  <label style={fieldLabel}>Nome de quem pediu<input value={p.name} style={inputStyle} onChange={(e) => setPaper(i, { name: e.target.value })} /></label>
                  <label style={fieldLabel}>CNS de quem pediu<input value={p.cns} inputMode="numeric" style={inputStyle} onChange={(e) => setPaper(i, { cns: e.target.value })} /></label>
                </>
              )}
              <div>
                <button type="button" style={secondaryButtonStyle} onClick={() => set({ paper: draft.paper.filter((_, j) => j !== i) })}>Tirar este pedido</button>
              </div>
            </fieldset>
          ))}
          <div>
            <button type="button" style={secondaryButtonStyle} onClick={() => set({ paper: [ ...draft.paper, EMPTY_PAPER ] })}>Incluir pedido em papel</button>
          </div>
        </>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <ActionButton onClick={submit} disabledReason={patient ? null : "busque o paciente pelo CPF"}>Abrir requisição</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}
