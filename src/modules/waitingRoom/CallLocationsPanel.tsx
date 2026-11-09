// Módulo 32a (F-32.5): locais de chamada de uma unidade (consultório, sala de classificação), só do municipal_admin. Nome de 1 a 40
// (WaitingRoom::SaveCallLocation); criar, renomear, desativar e ativar passam pelo step-up (SensitiveAction, que repete a ação uma vez
// depois de um `mfa_required`). A chave da lista é a mesma do seletor de local da chamada (CallLocationPicker).
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createCallLocation, listCallLocations, updateCallLocation, type CallLocation, type HealthUnit } from "../../lib/api";
import { CALL_LOCATIONS_KEY, locationNameProblem, urgencyError } from "../../lib/urgency";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "../exams/styles";

type Pending =
  | { kind: "add"; name: string }
  | { kind: "rename"; loc: CallLocation; name: string }
  | { kind: "toggle"; loc: CallLocation };

const DONE: Record<string, string> = {
  add: "Local adicionado.", rename: "Local renomeado.", deactivate: "Local desativado.", activate: "Local ativado."
};

export function CallLocationsPanel({ unit, onGoToSecurity }: { unit: HealthUnit; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const key = [ CALL_LOCATIONS_KEY, unit.id ];
  const list = useQuery({ queryKey: key, queryFn: () => listCallLocations(unit.id), refetchOnWindowFocus: false });
  const [ name, setName ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ renaming, setRenaming ] = useState<{ loc: CallLocation; name: string } | null>(null);
  const [ renameProblem, setRenameProblem ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  function add(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const found = locationNameProblem(name);
    setProblem(found);
    setPending(found ? null : { kind: "add", name: name.trim() });
  }
  function rename(event: FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const found = locationNameProblem(renaming.name);
    setRenameProblem(found);
    setPending(found ? null : { kind: "rename", loc: renaming.loc, name: renaming.name.trim() });
  }
  function finished(p: Pending) {
    setPending(null);
    if (p.kind === "add") { setName(""); setNotice(DONE.add); }
    else if (p.kind === "rename") { setRenaming(null); setNotice(DONE.rename); }
    else setNotice(p.loc.active ? DONE.deactivate : DONE.activate);
    void queryClient.invalidateQueries({ queryKey: key });
  }
  function run(p: Pending): Promise<unknown> {
    if (p.kind === "add") return createCallLocation({ health_unit_id: unit.id, name: p.name, active: true });
    if (p.kind === "rename") return updateCallLocation(p.loc.id, { name: p.name, active: p.loc.active });
    return updateCallLocation(p.loc.id, { name: p.loc.name, active: !p.loc.active });
  }
  const busy = pending !== null;
  const items = list.data?.items ?? [];
  const noActive = items.every((l) => !l.active);

  return (
    <Panel title="Locais de chamada" sub={`${unit.name} · o local aparece na TV junto com a senha`}>
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {list.isPending && <p className="mono" style={muted}>carregando…</p>}
        {list.isError && <p role="alert" style={alert}>{urgencyError(list.error)}</p>}
        {list.data?.location_required && (noActive
          ? <p role="alert" style={alert}>Esta unidade tem TV pareada: sem local ativo, ninguém consegue chamar. Adicione ou ative um local.</p>
          : <p style={muted}>Esta unidade tem TV pareada: toda chamada pede o local.</p>)}
        {list.data && (
          <DataTable<CallLocation>
            cols={[
              { label: "Nome", w: "2fr", card: "title", render: (l) => l.name },
              { label: "Situação", w: "1fr", render: (l) => <Tag tone={l.active ? "ok" : undefined}>{l.active ? "ativo" : "inativo"}</Tag> },
              { label: "", w: "auto", align: "right", card: "actions", render: (l) => (
                <div style={{ ...row, justifyContent: "flex-end" }}>
                  <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={`Renomear ${l.name}`}
                    onClick={() => { setNotice(null); setRenameProblem(null); setRenaming({ loc: l, name: l.name }); }}>Renomear</button>
                  <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={`${l.active ? "Desativar" : "Ativar"} ${l.name}`}
                    onClick={() => { setNotice(null); setPending({ kind: "toggle", loc: l }); }}>{l.active ? "Desativar" : "Ativar"}</button>
                </div>
              ) }
            ]}
            rows={items}
            rowKey={(l) => l.id}
            empty="nenhum local cadastrado"
          />
        )}
        {renaming && (
          <form onSubmit={rename} style={{ ...row, alignItems: "flex-end" }}>
            <label style={{ ...fieldLabel, flex: "1 1 200px", maxWidth: 320 }}>
              {`Novo nome de ${renaming.loc.name}`}
              <input value={renaming.name} style={inputStyle} aria-invalid={renameProblem ? true : undefined}
                onChange={(e) => { setRenaming({ ...renaming, name: e.target.value }); setRenameProblem(null); }} />
            </label>
            <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Salvar nome</button>
            <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={() => setRenaming(null)}>Cancelar</button>
          </form>
        )}
        {renameProblem && <p role="alert" style={alert}>{renameProblem}</p>}
        <form onSubmit={add} style={{ ...row, alignItems: "flex-end" }}>
          <label style={{ ...fieldLabel, flex: "1 1 200px", maxWidth: 320 }}>
            Nome do local
            <input value={name} style={inputStyle} placeholder="ex.: Consultório 1" aria-invalid={problem ? true : undefined}
              onChange={(e) => { setName(e.target.value); setProblem(null); setNotice(null); }} />
          </label>
          <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Adicionar local</button>
        </form>
        {problem && <p role="alert" style={alert}>{problem}</p>}
        {pending && (
          <SensitiveAction
            key={pending.kind === "add" ? `add-${pending.name}` : `${pending.kind}-${pending.loc.id}`}
            title={pending.kind === "add" ? "Adicionar local" : pending.kind === "rename" ? "Renomear local"
              : pending.loc.active ? "Desativar local" : "Ativar local"}
            description={pending.kind === "add"
              ? `O local “${pending.name}” passa a ser oferecido na chamada desta unidade.`
              : pending.kind === "rename"
                ? `“${pending.loc.name}” passa a se chamar “${pending.name}”; as próximas chamadas mostram o nome novo.`
                : pending.loc.active
                  ? `O local “${pending.loc.name}” deixa de ser oferecido na chamada; as chamadas já feitas não mudam.`
                  : `O local “${pending.loc.name}” volta a ser oferecido na chamada.`}
            requiresStepUp
            run={() => run(pending).then(() => undefined)}
            onDone={() => finished(pending)}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(e) => urgencyError(e)}
          />
        )}
      </div>
    </Panel>
  );
}
