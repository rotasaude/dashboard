// Respondentes da ouvidoria (módulo 33; F-33.1): quem responde por cada setor ou unidade. Lista com ativar/desativar (confirmação);
// nova ligação: pessoa entre os candidatos (usuários da cidade; o api exige o papel `ombudsman_responder`, 422 `missing_responder_role`)
// e destino de `options` (setores e unidades), sem filtrar os que ainda não têm respondente. 409 `already_responder`. Nada em storage.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOmbudsmanResponder, getOmbudsmanOptions, listOmbudsmanResponders, listResponderCandidates, updateOmbudsmanResponder,
  type OmbudsmanResponder
} from "../../lib/api";
import { OMB_OPTIONS_KEY, OMB_RESPONDERS_KEY, STATIC_QUERY, destinationLabel, ombudsmanError, ombudsmanRefusals } from "../../lib/ombudsman";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { ConfirmButton } from "../../components/ConfirmButton";
import { DataTable } from "../../components/DataTable";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row, stack } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { DestinationSelect, parseDestination } from "./DestinationSelect";

const NO_PERSON = "escolha uma pessoa da lista";
const NO_DESTINATION = "escolha um setor ou uma unidade";
const CANDIDATES_NOTE = "Só pode ser ligada a pessoa que tem o papel de ponto de resposta (ombudsman_responder) nesta cidade.";

function NewResponder({ onCreated }: { onCreated(): void }) {
  const candidates = useQuery({ queryKey: [ OMB_RESPONDERS_KEY, "candidates" ], queryFn: listResponderCandidates, ...STATIC_QUERY });
  const options = useQuery({ queryKey: [ OMB_OPTIONS_KEY ], queryFn: getOmbudsmanOptions, ...STATIC_QUERY });
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err).map((r) => ({ ...r, participantIndex: null })) });
  const [ person, setPerson ] = useState("");
  const [ destination, setDestination ] = useState("");
  const own = (path: string) => path === "user_id" || path === "destination";
  const loadError = candidates.error ?? options.error;
  return (
    <form ref={f.formRef} aria-label="Nova ligação de respondente" style={form} noValidate onSubmit={(ev) => {
      const dest = parseDestination(destination);
      void f.submit(ev, {
        check: () => [ ...(person ? [] : [ { path: "user_id", text: NO_PERSON } ]), ...(dest ? [] : [ { path: "destination", text: NO_DESTINATION } ]) ],
        call: () => createOmbudsmanResponder(dest!.kind === "department" ? { user_id: person, department_id: dest!.id } : { user_id: person, health_unit_id: dest!.id }),
        ok: () => { setPerson(""); setDestination(""); onCreated(); },
        // O api também recusa pelo destino (`department_id`/`health_unit_id`): a frase fica no campo do destino.
        refused: (refusals) => refusals.map((r) => ({ path: /^(department_id|health_unit_id)$/.test(r.path) ? "destination" : r.path, text: r.text }))
      });
    }}>
      {loadError !== null && <p role="alert" style={alert}>{ombudsmanRefusals(loadError)[0].text}</p>}
      {f.top(own)}
      <div style={fieldLabel}>
        <label htmlFor={f.fid("user_id")}>Pessoa</label>
        <select id={f.fid("user_id")} style={inputStyle} value={person} onChange={(e) => { f.clear("user_id"); setPerson(e.target.value); }} {...f.aria("user_id")}>
          <option value="">Escolha a pessoa</option>
          {(candidates.data ?? []).map((c) => <option key={c.id} value={c.id}>{`${c.name} — ${c.email}`}</option>)}
        </select>
        {f.errNode("user_id")}
      </div>
      <div style={fieldLabel}>
        <label htmlFor={f.fid("destination")}>Destino do respondente</label>
        <DestinationSelect id={f.fid("destination")} value={destination} onChange={(v) => { f.clear("destination"); setDestination(v); }}
          departments={options.data?.departments ?? []} healthUnits={options.data?.health_units ?? []}
          style={inputStyle} {...f.aria("destination")} />
        {f.errNode("destination")}
      </div>
      <p style={muted}>{CANDIDATES_NOTE}</p>
      <div style={row}>
        <button type="submit" disabled={f.busy} style={f.busy ? disabledButtonStyle : buttonStyle}>Ligar respondente</button>
      </div>
    </form>
  );
}

export function RespondersPanel() {
  const queryClient = useQueryClient();
  const responders = useQuery({ queryKey: [ OMB_RESPONDERS_KEY ], queryFn: listOmbudsmanResponders, ...STATIC_QUERY });
  const msg = useActionMessage();
  // A lista e o `has_active_responder` de `options` mudam juntos.
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: [ OMB_RESPONDERS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ OMB_OPTIONS_KEY ] });
  };
  const toggle = async (r: OmbudsmanResponder) => {
    msg.start();
    try {
      await updateOmbudsmanResponder(r.id, { active: !r.active });
      changed();
      msg.ok(r.active ? "Respondente desativado." : "Respondente reativado.");
    } catch (err) { msg.fail(ombudsmanError(err)); }
  };
  return (
    <Panel title="Respondentes" sub="quem responde por cada setor ou unidade">
      <div style={stack}>
        {responders.isPending && <p className="mono" style={muted}>carregando…</p>}
        {responders.isError && <p role="alert" style={alert}>{ombudsmanRefusals(responders.error)[0].text}</p>}
        {responders.data && (
          <DataTable<OmbudsmanResponder> label="Respondentes" rows={responders.data} rowKey={(r) => r.id} empty="Nenhum respondente ligado ainda"
            cols={[
              { label: "Pessoa", w: "1.4fr", card: "title", render: (r) => <span><strong>{r.user.name}</strong><br /><span style={muted}>{r.user.email}</span></span> },
              { label: "Destino", w: "1.4fr", render: (r) => destinationLabel(r.destination) },
              { label: "Situação", w: "0.8fr", render: (r) => <Tag tone={r.active ? "ok" : "info"}>{r.active ? "ativo" : "desativado"}</Tag> },
              { label: "Ação", w: "1.2fr", card: "actions", render: (r) => {
                const who = `${r.user.name} — ${r.destination.name}`;
                return <ConfirmButton label={r.active ? `Desativar ${who}` : `Reativar ${who}`}
                  question={r.active ? `Desativar ${r.user.name} neste destino?` : `Reativar ${r.user.name} neste destino?`} onConfirm={() => toggle(r)} />;
              } }
            ]} />
        )}
        <ActionMessage message={msg.message} />
        <NewResponder onCreated={changed} />
      </div>
    </Panel>
  );
}
