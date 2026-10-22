// src/modules/BillingProcedures.tsx
// Procedimentos realizados da cidade (contrato §3): o faturista e o
// municipal_admin filtram por estabelecimento, competência, crítica, motivo e
// paciente; o faturista cancela qualquer procedimento (Divergência B12). A
// lista traz paciente e GRAVA trilha (billing_procedures.listed, E19): lida só
// ao abrir, ao filtrar e depois de uma ação — nunca sozinha (sem polling, sem
// releitura ao voltar à aba ou à rede). Na URL só ids, códigos e a competência.
import { useState, type CSSProperties, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { listBillingEstablishments, listProcedures, type BillingEstablishment, type BillingPatient } from "../lib/api";
import {
  EMPTY_FILTERS, ESTABLISHMENTS_KEY, PROCEDURES_KEY, REASON_CODES, billingError, establishmentKey, establishmentLabel, isStale, procedureQuery,
  reasonLabel, type ProcedureFilters
} from "../lib/billing";
import { competenceLabel, competenceOptions } from "../lib/competence";
import { todayInCity } from "../lib/campaigns";
import { Panel } from "../components/Panel";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { BillingGate } from "./billing/BillingGate";
import { BillingPatientLookup } from "./billing/BillingPatientLookup";
import { ProcedureTable } from "./billing/ProcedureTable";
import { ManualEntrySection } from "./billing/ManualEntryPanel";

export function BillingProcedures({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <BillingGate title="Procedimentos realizados" sub="faturamento · crítica SIGTAP, cancelamento e lançamento manual"
      allow={(r) => r.clerk || r.admin}>
      {(roles) => (
        <ProceduresBody clerk={roles.clerk} today={today} headerActions={roles.clerk ? ({ establishments, onSaved }) => (
          <ManualEntrySection establishments={establishments} today={today} onSaved={onSaved} />
        ) : undefined} />
      )}
    </BillingGate>
  );
}

// `headerActions` recebe os estabelecimentos e o aviso da tela (Task 10: lançamento manual).
export function ProceduresBody({ clerk, today, headerActions }: {
  clerk: boolean; today: string;
  headerActions?(a: { establishments: BillingEstablishment[]; onSaved(message: string): void }): ReactNode;
}) {
  const queryClient = useQueryClient();
  const establishments = useQuery({ queryKey: [ ESTABLISHMENTS_KEY ], queryFn: listBillingEstablishments, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [ draft, setDraft ] = useState<ProcedureFilters>(() => EMPTY_FILTERS(today));
  const [ patient, setPatient ] = useState<BillingPatient | null>(null);
  const [ applied, setApplied ] = useState<ProcedureFilters>(() => EMPTY_FILTERS(today));
  const [ notice, setNotice ] = useState<string | null>(null);
  const set = (patch: Partial<ProcedureFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const query = useInfiniteQuery({
    queryKey: [ PROCEDURES_KEY, applied ],
    queryFn: ({ pageParam }) => listProcedures({ ...procedureQuery(applied), before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false
  });
  const rows = (query.data?.pages ?? []).flatMap((p) => p.procedures);
  // E19: cada leitura grava trilha. Depois de uma ação, volta à 1ª página (reset), sem reler as páginas já carregadas.
  const reload = () => void queryClient.resetQueries({ queryKey: [ PROCEDURES_KEY ] });

  // invalid_cursor: a lista mudou enquanto se rolava — recomeça da 1ª página, como a frase diz.
  async function loadMore() {
    const result = await query.fetchNextPage();
    if (result.isError && isStale(result.error)) { setNotice(billingError(result.error)); reload(); }
  }

  function apply() {
    setNotice(null);
    setApplied({ ...draft, patientId: patient?.id ?? null, reason: draft.billable === "false" ? draft.reason : "" });
  }

  function clear() {
    setNotice(null);
    setPatient(null);
    setDraft(EMPTY_FILTERS(today));
    setApplied(EMPTY_FILTERS(today));
  }

  return (
    <div style={stack}>
      {headerActions?.({ establishments: establishments.data ?? [], onSaved: (message) => { setNotice(message); reload(); } })}
      <Panel title="Filtros">
        <fieldset aria-label="filtros dos procedimentos" style={fieldsetStyle}>
          <div style={{ ...row, alignItems: "flex-end" }}>
            <label style={fieldLabel}>
              Estabelecimento
              <select value={draft.establishment} style={inputStyle} onChange={(e) => set({ establishment: e.target.value })}>
                <option value="">todos</option>
                {(establishments.data ?? []).map((e) => <option key={establishmentKey(e)} value={establishmentKey(e)}>{establishmentLabel(e)}</option>)}
              </select>
            </label>
            <label style={fieldLabel}>
              Competência
              <select value={draft.competence} style={inputStyle} onChange={(e) => set({ competence: e.target.value })}>
                {/* Sem competência na consulta: o registro de UBS (establishment_is_aps) não tem competência. */}
                <option value="">{ALL_COMPETENCES}</option>
                {competenceOptions(today, draft.competence).map((c) => <option key={c} value={c}>{competenceLabel(c)}</option>)}
              </select>
            </label>
            <label style={fieldLabel}>
              Crítica
              <select value={draft.billable} style={inputStyle} onChange={(e) => set({ billable: e.target.value as ProcedureFilters["billable"] })}>
                <option value="">todos</option>
                <option value="true">faturáveis</option>
                <option value="false">não faturáveis</option>
              </select>
            </label>
            {draft.billable === "false" && (
              <label style={fieldLabel}>
                Motivo
                <select value={draft.reason} style={inputStyle} onChange={(e) => set({ reason: e.target.value })}>
                  <option value="">todos os motivos</option>
                  {REASON_CODES.map((code) => <option key={code} value={code}>{reasonLabel(code)}</option>)}
                </select>
              </label>
            )}
          </div>
          <BillingPatientLookup patient={patient} onFound={setPatient} />
          <div style={row}>
            <button type="button" style={buttonStyle} onClick={apply}>Filtrar</button>
            <button type="button" style={secondaryButtonStyle} onClick={clear}>Limpar filtros</button>
          </div>
          {establishments.isError && <p role="alert" style={alert}>{billingError(establishments.error)}</p>}
        </fieldset>
      </Panel>
      <Panel title="Procedimentos" sub={applied.competence ? `competência ${competenceLabel(applied.competence)}` : ALL_COMPETENCES}>
        <div style={{ ...stack, padding: 16 }}>
          {notice && <p role="status" style={statusStyle}>{notice}</p>}
          {query.isPending && <p className="mono" style={muted}>carregando…</p>}
          {query.isError && <p role="alert" style={alert}>{billingError(query.error)}</p>}
          {query.data && (
            <ProcedureTable rows={rows} billing canCancel={() => clerk}
              onChanged={(message) => { setNotice(message); reload(); }} onStale={reload} />
          )}
          {query.hasNextPage && (
            <div>
              <button type="button" style={secondaryButtonStyle} disabled={query.isFetchingNextPage} onClick={() => void loadMore()}>
                Carregar mais
              </button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

const ALL_COMPETENCES = "todas as competências";
const fieldsetStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, border: 0, margin: 0, padding: 16 };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
