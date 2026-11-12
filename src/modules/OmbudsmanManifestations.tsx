// Casca da tela "Caixa da ouvidoria" (módulo 33): portão pronto; o conteúdo vem nas próximas tasks.
import { EmptyState } from "../components/EmptyState";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";

export function OmbudsmanManifestations() {
  return (
    <OmbudsmanGate title="Caixa da ouvidoria" sub="manifestações por estado e prazo" allow={(r) => r.staff}>
      {() => <EmptyState title="em construção" />}
    </OmbudsmanGate>
  );
}
