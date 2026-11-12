// Casca do detalhe da manifestação (módulo 33): só o título e "Voltar à caixa"; o conteúdo vem na Task 5.
import { useQuery } from "@tanstack/react-query";
import { getOmbudsmanManifestation } from "../../lib/api";
import { NOMINAL_QUERY, OMB_DETAIL_KEY, ombudsmanError, type OmbudsmanRoles } from "../../lib/ombudsman";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, row, stack, title } from "../exams/styles";

export function ManifestationView({ id, onBack }: { id: string; roles: OmbudsmanRoles; now?: Date; onBack(): void }) {
  const detail = useQuery({ queryKey: [ OMB_DETAIL_KEY, id ], queryFn: () => getOmbudsmanManifestation(id), ...NOMINAL_QUERY });
  return (
    <div style={stack}>
      <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onBack}>Voltar à caixa</button></div>
      {detail.isError && <p role="alert" style={alert}>{ombudsmanError(detail.error)}</p>}
      {detail.data && <h2 style={title}>{`Manifestação ${detail.data.protocol}`}</h2>}
    </div>
  );
}
