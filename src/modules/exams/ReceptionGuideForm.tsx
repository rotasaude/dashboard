// src/modules/exams/ReceptionGuideForm.tsx
// Guia da recepção (spec §6; contrato §3 POST /exams/orders): pedido feito
// fora do Rota Saúde, cadastrado pela guia de papel. Paciente pelo CPF,
// exame do catálogo da cidade (D3), prioridade, CID-10 opcional, quem pediu
// (profissional com vínculo na unidade — D5 — ou nome e CNS digitados) e a
// foto ou o PDF da guia (obrigatório). O CPF sai da tela no sucesso.
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReceptionOrder, listExamCatalog, listExamRequesters, type ExamOrder, type ExamPatient, type HealthUnit
} from "../../lib/api";
import {
  EMPTY_GUIDE, EXAM_CATALOG_KEY, EXAM_REQUESTERS_KEY, examError, guideBody, guideProblem, refreshExams, type GuideDraft
} from "../../lib/exams";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { PatientLookup } from "./PatientLookup";
import { UploadField } from "./UploadField";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "./styles";

export function ReceptionGuideForm({ unit, onDone, onCancel }: { unit: HealthUnit; onDone(order: ExamOrder): void; onCancel(): void }) {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: [ EXAM_CATALOG_KEY ], queryFn: listExamCatalog, retry: false, gcTime: 0, staleTime: 0 });
  const requesters = useQuery({ queryKey: [ EXAM_REQUESTERS_KEY, unit.id ], queryFn: () => listExamRequesters(unit.id), retry: false, gcTime: 0, staleTime: 0 });
  const [ patient, setPatient ] = useState<ExamPatient | null>(null);
  const [ draft, setDraft ] = useState<GuideDraft>(EMPTY_GUIDE);
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  // O anexo é documento do paciente: trocar o paciente descarta o anexo e
  // remonta o campo (some o nome do arquivo e o arquivo escolhido).
  const [ uploadKey, setUploadKey ] = useState(0);
  const [ reattach, setReattach ] = useState(false);
  const set = (patch: Partial<GuideDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Sempre que sai um paciente, o campo é remontado — também com um envio em
  // andamento, cujo resultado o campo desmontado ignora.
  function changePatient(next: ExamPatient | null) {
    if (patient && next?.id !== patient.id) {
      if (draft.guideUploadId) setReattach(true);
      set({ guideUploadId: null });
      setUploadKey((k) => k + 1);
    }
    setPatient(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!patient) { setError("busque o paciente pelo CPF"); return; }
    const problem = guideProblem(draft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const order = await createReceptionOrder(guideBody(draft, patient.id, unit.id));
      await refreshExams(queryClient);
      setPatient(null);
      setDraft(EMPTY_GUIDE);
      onDone(order);
    } catch (err) {
      setError(examError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label="Nova guia" onSubmit={submit} style={form}>
      <PatientLookup patient={patient} onFound={changePatient} />
      {catalog.isError && <p role="alert" style={alert}>{examError(catalog.error)}</p>}
      {catalog.isSuccess && (
        <label style={fieldLabel}>
          Exame
          <select value={draft.sigtapCode} style={inputStyle} onChange={(e) => set({ sigtapCode: e.target.value })}>
            <option value="">escolha…</option>
            {catalog.data.map((c) => <option key={c.sigtap_code} value={c.sigtap_code}>{`${c.label} (${c.sigtap_code})`}</option>)}
          </select>
        </label>
      )}
      <fieldset style={fieldset}>
        <legend style={legend}>Prioridade</legend>
        <label style={checkLabel}>
          <input type="radio" name="guide-priority" checked={draft.priority === "routine"} onChange={() => set({ priority: "routine" })} />Rotina
        </label>
        <label style={checkLabel}>
          <input type="radio" name="guide-priority" checked={draft.priority === "urgent"} onChange={() => set({ priority: "urgent" })} />Urgente
        </label>
      </fieldset>
      <label style={fieldLabel}>
        CID-10 de justificativa (opcional)
        <input value={draft.cid10} placeholder="ex.: E11" style={inputStyle} onChange={(e) => set({ cid10: e.target.value })} />
      </label>
      <fieldset style={fieldset}>
        <legend style={legend}>Quem pediu</legend>
        <label style={checkLabel}>
          <input type="radio" name="guide-requester" checked={draft.requesterMode === "linked"} onChange={() => set({ requesterMode: "linked" })} />
          Profissional da rede
        </label>
        <label style={checkLabel}>
          <input type="radio" name="guide-requester" checked={draft.requesterMode === "typed"} onChange={() => set({ requesterMode: "typed" })} />
          Outro (nome e CNS)
        </label>
        {draft.requesterMode === "linked" && requesters.isError && <p role="alert" style={alert}>{examError(requesters.error)}</p>}
        {draft.requesterMode === "linked" && requesters.isSuccess && (
          <label style={fieldLabel}>
            Profissional que pediu
            <select value={draft.requesterId} style={inputStyle} onChange={(e) => set({ requesterId: e.target.value })}>
              <option value="">escolha…</option>
              {requesters.data.map((r) => <option key={r.user_id} value={r.user_id}>{r.name}</option>)}
            </select>
          </label>
        )}
        {draft.requesterMode === "typed" && (
          <>
            <label style={fieldLabel}>
              Nome de quem pediu
              <input value={draft.requesterName} style={inputStyle} onChange={(e) => set({ requesterName: e.target.value })} />
            </label>
            <label style={fieldLabel}>
              CNS de quem pediu
              <input value={draft.requesterCns} inputMode="numeric" style={inputStyle} onChange={(e) => set({ requesterCns: e.target.value })} />
            </label>
          </>
        )}
      </fieldset>
      <label style={fieldLabel}>
        Número da guia no prestador (opcional)
        <input value={draft.externalReference} maxLength={60} style={inputStyle} onChange={(e) => set({ externalReference: e.target.value })} />
      </label>
      <UploadField key={uploadKey} label="Foto ou PDF da guia (até 10 MB)" uploadId={draft.guideUploadId}
        onUploaded={(guideUploadId) => { if (guideUploadId) setReattach(false); set({ guideUploadId }); }} />
      {reattach && <p role="status" style={muted}>anexe a guia de novo</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Registrar guia</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button>
      </div>
    </form>
  );
}
