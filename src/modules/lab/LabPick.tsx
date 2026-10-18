// Escolha do laboratório nas telas do 21c (toda lista pede `provider_id`, sem
// fallback de laboratório único) e se a sessão é RT ou substituto dele. O api
// dá ao admin todos os laboratórios ativos no mesmo contexto. Lista vazia já é
// barrada pelo LabGate (B32). Trocar de laboratório remonta o conteúdo.
// Nada é guardado em storage.
import { Fragment, useState, type ReactNode } from "react";
import { labError } from "../../lib/lab";
import { inputStyle } from "../../components/formStyles";
import { useLabContext } from "./useLabContext";
import { alert, fieldLabel, muted, stack } from "../exams/styles";

export interface LabChoice { id: string; name: string; lead: boolean }

export function LabPick({ children }: { children(lab: LabChoice): ReactNode }) {
  const context = useLabContext(true);
  const [ providerId, setProviderId ] = useState("");
  if (context.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (context.isError && !context.data) return <p role="alert" style={alert}>{labError(context.error)}</p>;
  const labs = context.data!.labs;
  const lab = labs.find((l) => l.id === providerId) ?? labs[0];
  if (!lab) return null;
  const lead = (context.data!.technical_lead_of ?? []).includes(lab.id);
  return (
    <div style={stack}>
      {labs.length > 1 && (
        <label style={fieldLabel}>
          Laboratório
          <select value={lab.id} style={inputStyle} onChange={(e) => setProviderId(e.target.value)}>
            {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      <Fragment key={lab.id}>{children({ id: lab.id, name: lab.name, lead })}</Fragment>
    </div>
  );
}
