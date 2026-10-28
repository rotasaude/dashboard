// src/modules/SurveillanceDiseases.tsx
// Doenças notificáveis (módulo 25; contrato §3; F-25.1). A lista nacional é da
// plataforma e aqui só se lê; as doenças locais são da cidade: criar, editar e
// desativar passam pelo step-up. Desativar tira a doença das sugestões; as
// notificações já feitas ficam. O formato é conferido aqui (recusar, nunca
// cortar) e de novo no api; a colisão de códigos com a lista nacional e com
// outras locais só o api sabe (409 duplicate_code, com `path`).
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createLocalDisease, listLocalDiseases, listSurveillanceDiseases, updateLocalDisease, type DiseaseDeadline, type LocalDisease, type NotifiableDisease } from "../lib/api";
import {
  DISEASES_KEY, LOCAL_DISEASES_KEY, STATIC_QUERY, codesOf, deadlineLabel, localDiseaseProblem, surveillanceError, type LocalDiseaseDraft
} from "../lib/surveillance";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, form, muted, row, stack } from "./exams/styles";
import { SurveillanceGate } from "./surveillance/SurveillanceGate";

export function SurveillanceDiseases({ onGoToSecurity }: { onGoToSecurity?(): void } = {}) {
  return (
    <SurveillanceGate title="Doenças notificáveis" sub="lista nacional e doenças da cidade" allow={(r) => r.surveillance}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </SurveillanceGate>
  );
}

const codes = (list: string[]): string => (list.length > 0 ? list.join(", ") : "—");
const NATIONAL_NOTE = "A lista nacional é mantida pela plataforma, a partir da portaria vigente.";
const CREATE_EFFECT = "As consultas passam a sugerir esta doença quando um dos códigos for registrado.";
const DEACTIVATE_EFFECT = "A doença some das sugestões; as notificações já feitas ficam.";

type Editing = LocalDisease | "new" | null;
type Toggle = { disease: LocalDisease; active: boolean } | null;

function Body({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const national = useQuery({ queryKey: [ DISEASES_KEY ], queryFn: listSurveillanceDiseases, ...STATIC_QUERY });
  const locals = useQuery({ queryKey: [ LOCAL_DISEASES_KEY ], queryFn: listLocalDiseases, ...STATIC_QUERY });
  const [ editing, setEditing ] = useState<Editing>(null);
  const [ toggle, setToggle ] = useState<Toggle>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const nationalList = (national.data ?? []).filter((d) => !d.local);
  const version = nationalList.find((d) => d.list_version !== null)?.list_version ?? null;

  // Depois de salvar relê as duas: a local entra nas sugestões da lista vigente.
  function saved(message: string) {
    setEditing(null); setToggle(null); setNotice(message);
    void queryClient.invalidateQueries({ queryKey: [ LOCAL_DISEASES_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ DISEASES_KEY ] });
  }
  const open = (next: Editing) => { setNotice(null); setToggle(null); setEditing(next); };

  return (
    <div style={stack}>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      <Panel title={version === null ? "Lista nacional" : `Lista nacional (versão ${version})`} sub="só leitura">
        <div style={stack}>
          <p style={muted}>{NATIONAL_NOTE}</p>
          {national.isPending && <p className="mono" style={muted}>carregando…</p>}
          {national.isError && <p role="alert" style={alert}>{surveillanceError(national.error)}</p>}
          {national.data && (
            <DataTable<NotifiableDisease>
              cols={[
                { label: "Doença", w: "2fr", card: "title", render: (d) => nameCell(d) },
                { label: "Prazo", w: "1fr", render: (d) => deadlineLabel(d.deadline) },
                { label: "CID-10", w: "1.2fr", render: (d) => codes(d.cid10) },
                { label: "CIAP-2", w: "1fr", render: (d) => codes(d.ciap2) },
                { label: "Repetição", w: "1fr", render: (d) => `${d.repeat_after_days} dias` }
              ]}
              rows={nationalList} rowKey={(d) => d.code} empty="a plataforma ainda não publicou a lista nacional"
            />
          )}
        </div>
      </Panel>
      <Panel title="Doenças da cidade" sub="as que a cidade acrescenta à lista nacional"
        right={<button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Nova doença local</button>}>
        <div style={stack}>
          {locals.isPending && <p className="mono" style={muted}>carregando…</p>}
          {locals.isError && <p role="alert" style={alert}>{surveillanceError(locals.error)}</p>}
          {locals.data && (
            <DataTable<LocalDisease>
              cols={[
                { label: "Doença", w: "2fr", card: "title", render: (d) => nameCell(d) },
                { label: "Código", w: "1.6fr", render: (d) => d.code },
                { label: "Prazo", w: "1fr", render: (d) => deadlineLabel(d.deadline) },
                { label: "Códigos", w: "1.4fr", render: (d) => `CID-10: ${codes(d.cid10)} · CIAP-2: ${codes(d.ciap2)}` },
                { label: "Situação", w: "90px", render: (d) => <Tag tone={d.active ? "ok" : "neutral"}>{d.active ? "ativa" : "inativa"}</Tag> },
                {
                  label: "Ação", w: "1.4fr", card: "actions", render: (d) => (
                    <div style={row}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => open(d)}>Editar</button>
                      <button type="button" style={secondaryButtonStyle}
                        onClick={() => { setNotice(null); setEditing(null); setToggle({ disease: d, active: !d.active }); }}>
                        {d.active ? "Desativar" : "Reativar"}
                      </button>
                    </div>
                  )
                }
              ]}
              rows={locals.data} rowKey={(d) => d.id} empty="a cidade ainda não acrescentou nenhuma doença"
            />
          )}
        </div>
      </Panel>
      {editing && (
        <LocalDiseaseForm key={editing === "new" ? "new" : editing.id} disease={editing === "new" ? null : editing}
          onSaved={saved} onCancel={() => setEditing(null)} onGoToSecurity={onGoToSecurity} />
      )}
      {toggle && (
        <SensitiveAction
          key={`${toggle.disease.id}-${toggle.active}`}
          title={toggle.active ? `Reativar ${toggle.disease.name}` : `Desativar ${toggle.disease.name}`}
          description={toggle.active ? CREATE_EFFECT : DEACTIVATE_EFFECT}
          requiresStepUp
          confirmLabel="Confirmar"
          run={async () => { await updateLocalDisease(toggle.disease.id, { active: toggle.active }); }}
          onDone={() => saved(`Doença ${toggle.disease.name} ${toggle.active ? "reativada" : "desativada"}.`)}
          onCancel={() => setToggle(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => surveillanceError(err)}
        />
      )}
    </div>
  );
}

// Nome e, logo abaixo, a nota (K13c: doença sem CID é só notificação manual, e a nota diz por quê).
function nameCell(d: NotifiableDisease) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span>{d.name}</span>
      {d.notes && <span style={muted}>{d.notes}</span>}
    </span>
  );
}

function draftOf(d: LocalDisease | null): LocalDiseaseDraft {
  return d
    ? { code: d.code, name: d.name, deadline: d.deadline, cid10: d.cid10.join(", "), ciap2: d.ciap2.join(", "), repeat_after_days: String(d.repeat_after_days) }
    : { code: "", name: "", deadline: "", cid10: "", ciap2: "", repeat_after_days: "30" };
}

// Corpo sem `code` (só a criação o leva) e sem `active` (desativar/reativar manda só `active`, para não desfazer edição alheia). O nome vai sem espaços nas pontas: o api exige `name.strip == name`.
function bodyOf(draft: LocalDiseaseDraft) {
  return {
    name: draft.name.trim(), deadline: draft.deadline as DiseaseDeadline, cid10: codesOf(draft.cid10), ciap2: codesOf(draft.ciap2),
    repeat_after_days: Number(draft.repeat_after_days.trim())
  };
}

function LocalDiseaseForm({ disease, onSaved, onCancel, onGoToSecurity }: {
  disease: LocalDisease | null; onSaved(message: string): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const [ draft, setDraft ] = useState<LocalDiseaseDraft>(() => draftOf(disease));
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const set = (patch: Partial<LocalDiseaseDraft>) => { setError(null); setDraft((d) => ({ ...d, ...patch })); };

  function review() {
    const problem = localDiseaseProblem(draft, disease === null);
    if (problem) { setError(problem); return; }
    setConfirming(true);
  }

  async function save() {
    const body = bodyOf(draft);
    if (disease) await updateLocalDisease(disease.id, body);
    else await createLocalDisease({ code: draft.code, ...body });
  }

  const input = (label: string, key: keyof LocalDiseaseDraft, hint: string, disabled = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label style={fieldLabel}>
        {label}
        <input value={draft[key]} disabled={disabled} style={inputStyle} onChange={(e) => set({ [key]: e.target.value })} />
      </label>
      <span style={hintStyle}>{hint}</span>
    </div>
  );

  const name = draft.name.trim();
  return (
    <section aria-label={disease ? "Editar doença local" : "Nova doença local"} style={box}>
      {/* Durante a confirmação o formulário fica à vista, parado: a recusa do api aparece junto dele e nada se perde. */}
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          {input("Código", "code", "começa com local_; letras minúsculas, números ou _ (até 46); não muda depois", disease !== null)}
          {input("Nome", "name", "de 1 a 120 caracteres")}
          <label style={fieldLabel}>
            Prazo
            <select value={draft.deadline} style={inputStyle} onChange={(e) => set({ deadline: e.target.value })}>
              <option value="">escolha</option>
              <option value="immediate">{deadlineLabel("immediate")}</option>
              <option value="weekly">{deadlineLabel("weekly")}</option>
            </select>
          </label>
          {input("CID-10", "cid10", "separados por vírgula, ex.: W57, R17.0")}
          {input("CIAP-2", "ciap2", "separados por vírgula, ex.: A77")}
          {input("Janela de repetição (dias)", "repeat_after_days", "dias em que uma nova suspeita do mesmo paciente não repete a sugestão")}
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && (
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={review}>Revisar</button>
              <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
            </div>
          )}
        </div>
      </fieldset>
      {confirming && (
        <SensitiveAction
          title={disease ? `Salvar ${name}` : `Criar a doença ${name}`}
          description={disease ? `As alterações valem para as próximas sugestões. ${CREATE_EFFECT}` : CREATE_EFFECT}
          requiresStepUp
          confirmLabel="Confirmar"
          run={save}
          onDone={() => onSaved(`Doença ${name} salva.`)}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => surveillanceError(err)}
        />
      )}
    </section>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
const hintStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink3)" };
const fieldsetStyle: CSSProperties = { border: "none", padding: 0, margin: 0, minWidth: 0 };
