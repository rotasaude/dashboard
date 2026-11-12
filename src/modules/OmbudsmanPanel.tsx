// Casca da tela "Painel da ouvidoria" (módulo 33): portão pronto; o conteúdo vem nas próximas tasks.
import { EmptyState } from "../components/EmptyState";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";

export function OmbudsmanPanel() {
  return (
    <OmbudsmanGate title="Painel da ouvidoria" sub="volume, prazos, resolutividade e satisfação" allow={(r) => r.staff}>
      {() => <EmptyState title="em construção" />}
    </OmbudsmanGate>
  );
}
