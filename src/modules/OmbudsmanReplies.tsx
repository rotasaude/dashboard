// Casca da tela "Respostas à ouvidoria" (módulo 33): portão pronto; o conteúdo vem nas próximas tasks.
import { EmptyState } from "../components/EmptyState";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";

export function OmbudsmanReplies() {
  return (
    <OmbudsmanGate title="Respostas à ouvidoria" sub="encaminhamentos do seu setor ou unidade" allow={(r) => r.responder}>
      {() => <EmptyState title="em construção" />}
    </OmbudsmanGate>
  );
}
