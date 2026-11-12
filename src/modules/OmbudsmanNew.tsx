// Tela "Nova manifestação" (módulo 33; F-33.4): o registro pela equipe e, registrado, o resultado com o comprovante. O formulário
// desmonta ao registrar (nada do que foi digitado fica); "Registrar outra" volta a um formulário vazio. "Abrir a manifestação"
// leva à Caixa pelo handoff do shell (só o id, em memória).
import { useState } from "react";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";
import { NewManifestationForm } from "./ombudsman/NewManifestationForm";
import { Receipt, type CreatedManifestation } from "./ombudsman/Receipt";

export function OmbudsmanNew({ onOpenManifestation }: { onOpenManifestation(id: string): void }) {
  const [ created, setCreated ] = useState<CreatedManifestation | null>(null);
  return (
    <OmbudsmanGate title="Nova manifestação" sub="registro pela equipe" allow={(r) => r.staff}>
      {() => (created
        ? <Receipt created={created} onNew={() => setCreated(null)} onOpen={() => onOpenManifestation(created.id)} />
        : <NewManifestationForm onCreated={setCreated} />)}
    </OmbudsmanGate>
  );
}
