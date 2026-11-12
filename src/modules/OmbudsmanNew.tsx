// Casca da tela "Nova manifestação" (módulo 33): portão pronto; o conteúdo vem nas próximas tasks.
import { EmptyState } from "../components/EmptyState";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";

export function OmbudsmanNew() {
  return (
    <OmbudsmanGate title="Nova manifestação" sub="registro pela equipe" allow={(r) => r.staff}>
      {() => <EmptyState title="em construção" />}
    </OmbudsmanGate>
  );
}
