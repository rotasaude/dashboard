// Encaminhar (`in_analysis`, `forwarded`; `forward.rb`): um destino — setor ou unidade — com respondente ativo (sem ele, a
// opção fica indisponível) e o extrato (20–4000) que o destino lê no lugar do texto original. O extrato tem, antes do envio,
// `EXTRACT_NOTICE` e o aviso de texto congelado. Corpo `{ expected_state, department_id | health_unit_id, extract }`.
// `destination_without_responder` e os paths do destino voltam ao campo Destino; o extrato digitado fica.
import { useState } from "react";
import type { OmbudsmanOptions } from "../../../lib/api";
import { forwardProblems } from "../../../lib/ombudsman";
import type { PsyRefusal } from "../../../lib/psychosocial";
import { inputStyle } from "../../../components/formStyles";
import { fieldLabel, form } from "../../exams/styles";
import { DestinationSelect, parseDestination } from "../DestinationSelect";
import { useActionForm, type ActionFormProps } from "../useManifestationAction";
import { ExtractField } from "./ExtractField";
import { FormButtons, formTitle } from "./TextActionForm";

const OWN = [ "destination", "extract" ];
const DESTINATION_PATHS = [ "department_id", "health_unit_id" ];
const FIELDS = {
  department_id: "escolha um destino ativo: um setor ou uma unidade", health_unit_id: "escolha um destino ativo: um setor ou uma unidade"
};

export function ForwardForm({ options, run, onDone, onClose }: ActionFormProps & { options: OmbudsmanOptions }) {
  const f = useActionForm(FIELDS);
  const { aria, errNode, busy } = f;
  const [ destination, setDestination ] = useState("");
  const [ extract, setExtract ] = useState("");

  const body = (): Record<string, unknown> => {
    const d = parseDestination(destination);
    return d?.kind === "department" ? { department_id: d.id, extract } : { health_unit_id: d?.id, extract };
  };
  const refused = (rs: PsyRefusal[]) => rs.map((r) => ({
    path: r.code === "destination_without_responder" || DESTINATION_PATHS.includes(r.path) ? "destination" : r.path, text: r.text
  }));

  return (
    <form ref={f.formRef} aria-label="Encaminhar" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => forwardProblems({ destination: parseDestination(destination), extract }, options),
        call: () => run("forward", body()), ok: onDone, stale: () => {}, refused
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>Encaminhar</p>
      {f.top((path) => OWN.includes(path))}
      <label style={fieldLabel}>
        Destino
        <DestinationSelect value={destination} departments={options.departments} healthUnits={options.health_units} requireResponder
          style={inputStyle} {...aria("destination")} onChange={(v) => { f.clear("destination"); setDestination(v); }} />
      </label>
      {errNode("destination")}
      <ExtractField id={f.fid("extract")} value={extract} aria={aria("extract")} onChange={(v) => { f.clear("extract"); setExtract(v); }} />
      {errNode("extract")}
      <FormButtons busy={busy} submit="Encaminhar agora" onClose={onClose} />
    </form>
  );
}
