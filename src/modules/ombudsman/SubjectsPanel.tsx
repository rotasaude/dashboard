// Assuntos da ouvidoria (módulo 33; F-33.1): árvore de dois níveis de `GET /ombudsman/subjects`, que traz também os desativados
// (marcados). Novo assunto, ou subassunto de um assunto de primeiro nível ativo ("Dentro de"); renomear no lugar; desativar/reativar
// com confirmação. O pai não muda depois de criado e assunto não se apaga. Recusas do api (`name_taken`, `too_deep`…) vêm por
// `ombudsmanRefusals`. Nada em storage.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createOmbudsmanSubject, listOmbudsmanSubjects, updateOmbudsmanSubject } from "../../lib/api";
import { OMB_OPTIONS_KEY, OMB_SUBJECTS_KEY, STATIC_QUERY, nameProblem, ombudsmanError, ombudsmanRefusals } from "../../lib/ombudsman";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row, stack } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { RenameInline } from "./RenameInline";

type Item = { id: string; name: string; active: boolean };

function NewSubject({ roots, onCreated }: { roots: Item[]; onCreated(): void }) {
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err).map((r) => ({ ...r, participantIndex: null })) });
  const [ name, setName ] = useState("");
  const [ parent, setParent ] = useState("");
  const own = (path: string) => path === "name" || path === "parent_id";
  return (
    <form ref={f.formRef} aria-label="Novo assunto" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => { const p = nameProblem(name); return p ? [ { path: "name", text: p } ] : []; },
        call: () => createOmbudsmanSubject({ name: name.trim(), parent_id: parent || null }),
        ok: () => { setName(""); onCreated(); }
      });
    }}>
      {f.top(own)}
      <div style={fieldLabel}>
        <label htmlFor={f.fid("parent_id")}>Dentro de</label>
        <select id={f.fid("parent_id")} style={inputStyle} value={parent} onChange={(e) => { f.clear("parent_id"); setParent(e.target.value); }} {...f.aria("parent_id")}>
          <option value="">— assunto de primeiro nível —</option>
          {roots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {f.errNode("parent_id")}
      </div>
      <div style={fieldLabel}>
        <label htmlFor={f.fid("name")}>Nome do assunto</label>
        <input id={f.fid("name")} type="text" style={inputStyle} value={name} onChange={(e) => { f.clear("name"); setName(e.target.value); }} {...f.aria("name")} />
        {f.errNode("name")}
      </div>
      <div style={row}>
        <button type="submit" disabled={f.busy} style={f.busy ? disabledButtonStyle : buttonStyle}>Adicionar assunto</button>
      </div>
    </form>
  );
}

function SubjectRow({ s, child, onChanged, msg }: {
  s: Item; child: boolean; onChanged(): void; msg: ReturnType<typeof useActionMessage>;
}) {
  const [ renaming, setRenaming ] = useState(false);
  const save = async (name: string, active: boolean) => { await updateOmbudsmanSubject(s.id, { name, active }); onChanged(); };
  const toggle = async () => {
    msg.start();
    try {
      await save(s.name, !s.active);
      msg.ok(s.active ? "Assunto desativado." : "Assunto reativado.");
    } catch (err) { msg.fail(ombudsmanError(err)); }
  };
  return (
    <li style={{ ...row, marginLeft: child ? 24 : 0, justifyContent: "space-between" }}>
      {renaming ? (
        <RenameInline name={s.name} onSave={(name) => save(name, s.active)} onClose={() => setRenaming(false)} />
      ) : (
        <>
          <span style={row}>
            <strong style={{ fontWeight: child ? 400 : 600 }}>{s.name}</strong>
            {!s.active && <Tag tone="info">desativado</Tag>}
          </span>
          <span style={row}>
            <button type="button" style={secondaryButtonStyle} aria-label={`Renomear ${s.name}`} onClick={() => { msg.start(); setRenaming(true); }}>Renomear</button>
            <ConfirmButton label={s.active ? `Desativar ${s.name}` : `Reativar ${s.name}`}
              question={s.active ? `Desativar o assunto ${s.name}?` : `Reativar o assunto ${s.name}?`} onConfirm={toggle} />
          </span>
        </>
      )}
    </li>
  );
}

export function SubjectsPanel() {
  const queryClient = useQueryClient();
  const subjects = useQuery({ queryKey: [ OMB_SUBJECTS_KEY ], queryFn: listOmbudsmanSubjects, ...STATIC_QUERY });
  const msg = useActionMessage();
  // A lista e as `options` (assuntos ativos da caixa) mudam juntas.
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: [ OMB_SUBJECTS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ OMB_OPTIONS_KEY ] });
  };
  const tree = subjects.data ?? [];
  return (
    <Panel title="Assuntos" sub="dois níveis; desativar tira da escolha, não apaga">
      <div style={stack}>
        {subjects.isPending && <p className="mono" style={muted}>carregando…</p>}
        {subjects.isError && <p role="alert" style={alert}>{ombudsmanRefusals(subjects.error)[0].text}</p>}
        {subjects.data && (
          <ul style={{ ...stack, gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
            {tree.map((s) => (
              <li key={s.id} style={{ listStyle: "none" }}>
                <ul style={{ ...stack, gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
                  <SubjectRow s={s} child={false} onChanged={changed} msg={msg} />
                  {(s.children ?? []).map((c) => <SubjectRow key={c.id} s={c} child onChanged={changed} msg={msg} />)}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <ActionMessage message={msg.message} />
        <NewSubject roots={tree.filter((s) => s.active)} onCreated={changed} />
      </div>
    </Panel>
  );
}
