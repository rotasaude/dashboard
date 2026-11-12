// Tela "Setores da secretaria" (módulo 33; F-33.1): do municipal_admin, sem o portão do interruptor da ouvidoria (Q12). Lista,
// novo setor (nome 2–80, recusado e nunca cortado), renomear no lugar e desativar/reativar com confirmação; setor não se apaga
// (`rota_no_delete`). Recusas por `ombudsmanRefusals` (`name_taken` é 409). Nada em storage.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createDepartment, listDepartments, updateDepartment, type Department } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DEPARTMENTS_KEY, OMBUDSMAN_NO_ROLE, OMB_OPTIONS_KEY, STATIC_QUERY, nameProblem, ombudsmanError, ombudsmanRefusals, ombudsmanRoles } from "../lib/ombudsman";
import { useActionMessage } from "../lib/useActionMessage";
import { ActionMessage } from "../components/ActionMessage";
import { ConfirmButton } from "../components/ConfirmButton";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, form, muted, row, stack } from "./exams/styles";
import { RenameInline } from "./ombudsman/RenameInline";
import { useFormProblems } from "./psychosocial/useFormProblems";

function NewDepartment({ onCreated }: { onCreated(): void }) {
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err).map((r) => ({ ...r, participantIndex: null })) });
  const [ name, setName ] = useState("");
  return (
    <form ref={f.formRef} aria-label="Novo setor" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => { const p = nameProblem(name); return p ? [ { path: "name", text: p } ] : []; },
        call: () => createDepartment(name.trim()),
        ok: () => { setName(""); onCreated(); }
      });
    }}>
      {f.top((path) => path === "name")}
      <div style={fieldLabel}>
        <label htmlFor={f.fid("name")}>Nome do setor</label>
        <input id={f.fid("name")} type="text" style={inputStyle} value={name} onChange={(e) => { f.clear("name"); setName(e.target.value); }} {...f.aria("name")} />
        {f.errNode("name")}
      </div>
      <div style={row}>
        <button type="submit" disabled={f.busy} style={f.busy ? disabledButtonStyle : buttonStyle}>Adicionar setor</button>
      </div>
    </form>
  );
}

function DepartmentName({ d, onChanged, msg }: { d: Department; onChanged(): void; msg: ReturnType<typeof useActionMessage> }) {
  const [ renaming, setRenaming ] = useState(false);
  if (renaming) {
    return <RenameInline name={d.name} onClose={() => setRenaming(false)}
      onSave={async (name) => { await updateDepartment(d.id, { name, active: d.active }); onChanged(); }} />;
  }
  return (
    <span style={row}>
      <strong>{d.name}</strong>
      <button type="button" style={secondaryButtonStyle} aria-label={`Renomear ${d.name}`} onClick={() => { msg.start(); setRenaming(true); }}>Renomear</button>
    </span>
  );
}

function Body() {
  const queryClient = useQueryClient();
  const departments = useQuery({ queryKey: [ DEPARTMENTS_KEY ], queryFn: listDepartments, ...STATIC_QUERY });
  const msg = useActionMessage();
  // A lista e os destinos de `options` (setores ativos) mudam juntos.
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: [ DEPARTMENTS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ OMB_OPTIONS_KEY ] });
  };
  const toggle = async (d: Department) => {
    msg.start();
    try {
      await updateDepartment(d.id, { name: d.name, active: !d.active });
      changed();
      msg.ok(d.active ? "Setor desativado." : "Setor reativado.");
    } catch (err) { msg.fail(ombudsmanError(err)); }
  };
  return (
    <Panel title="Setores" sub="setores desativados saem da escolha; nenhum é apagado">
      <div style={stack}>
        {departments.isPending && <p className="mono" style={muted}>carregando…</p>}
        {departments.isError && <p role="alert" style={alert}>{ombudsmanRefusals(departments.error)[0].text}</p>}
        {departments.data && (
          <DataTable<Department> label="Setores" rows={departments.data} rowKey={(d) => d.id} empty="Nenhum setor cadastrado ainda"
            cols={[
              { label: "Setor", w: "2fr", card: "title", render: (d) => <DepartmentName d={d} onChanged={changed} msg={msg} /> },
              { label: "Situação", w: "0.8fr", render: (d) => <Tag tone={d.active ? "ok" : "info"}>{d.active ? "ativo" : "desativado"}</Tag> },
              { label: "Ação", w: "1.2fr", card: "actions", render: (d) => (
                <ConfirmButton label={d.active ? `Desativar ${d.name}` : `Reativar ${d.name}`}
                  question={d.active ? `Desativar o setor ${d.name}?` : `Reativar o setor ${d.name}?`} onConfirm={() => toggle(d)} />
              ) }
            ]} />
        )}
        <ActionMessage message={msg.message} />
        <NewDepartment onCreated={changed} />
      </div>
    </Panel>
  );
}

// Sem `OmbudsmanGate`: o api não pede o interruptor da ouvidoria nesta rota (Q12); só o papel de admin da cidade.
export function Departments() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div style={stack}>
      <PageHeader title="Setores da secretaria" sub="setores que recebem encaminhamentos" />
      {ombudsmanRoles(user).admin ? <Body /> : <EmptyState title={OMBUDSMAN_NO_ROLE} />}
    </div>
  );
}
