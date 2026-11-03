// src/modules/vaccination/ImmunizationDetail.tsx
// A dose aberta pela linha do tempo (módulo 29; D11/V10): lê ao abrir (a trilha fica no api; o motivo do cancelamento é lido ali) e
// nada fica no cache (gcTime 0). Só mostra a dose, sem ações.
import { useQuery } from "@tanstack/react-query";
import { getImmunization } from "../../lib/api";
import { NOMINAL_QUERY, vaccinationError } from "../../lib/vaccination";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, panel } from "../exams/styles";
import { ImmunizationRow } from "./ImmunizationRow";

export function ImmunizationDetail({ id, onClose }: { id: string; onClose(): void }) {
  const query = useQuery({ queryKey: [ "immunization", id ], queryFn: () => getImmunization(id), ...NOMINAL_QUERY });
  if (query.isPending) {
    return <section aria-label="Dose de vacina" style={panel}><p className="mono" style={muted}>carregando a dose…</p></section>;
  }
  return (
    <section aria-label="Dose de vacina" style={panel}>
      {query.isError || !query.data
        ? <p role="alert" style={alert}>{vaccinationError(query.error)}</p>
        : <ul style={{ margin: 0, padding: 0 }}><ImmunizationRow imm={query.data} onChanged={() => {}} /></ul>}
      <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button></div>
    </section>
  );
}
