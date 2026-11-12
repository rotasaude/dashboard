// Casca da tela "Relatório anual" (módulo 33): portão pronto; o conteúdo vem nas próximas tasks.
import { EmptyState } from "../components/EmptyState";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";

export function OmbudsmanAnnualReport() {
  return (
    <OmbudsmanGate title="Relatório anual" sub="relatório de gestão para publicar" allow={(r) => r.lead}>
      {() => <EmptyState title="em construção" />}
    </OmbudsmanGate>
  );
}
