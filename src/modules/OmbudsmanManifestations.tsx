// Tela "Caixa da ouvidoria" (módulo 33; F-33.5, F-33.6): a lista com filtros e, com uma manifestação escolhida (ou vinda do
// registro, `initialId`), o detalhe no lugar da lista. Ao voltar, o detalhe sai do cache: nada de dado pessoal fica para trás.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OMB_DETAIL_KEY } from "../lib/ombudsman";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";
import { ManifestationList } from "./ombudsman/ManifestationList";
import { ManifestationView } from "./ombudsman/ManifestationView";

export function OmbudsmanManifestations({ initialId = null, now }: { initialId?: string | null; now?: Date; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const [ openId, setOpenId ] = useState<string | null>(initialId);
  useEffect(() => { if (initialId) setOpenId(initialId); }, [ initialId ]);
  const back = () => {
    setOpenId(null);
    queryClient.removeQueries({ queryKey: [ OMB_DETAIL_KEY ] });
  };
  return (
    <OmbudsmanGate title="Caixa da ouvidoria" sub="manifestações por estado e prazo" allow={(r) => r.staff}>
      {(roles) => openId
        ? <ManifestationView id={openId} roles={roles} now={now} onBack={back} />
        : <ManifestationList onOpen={setOpenId} />}
    </OmbudsmanGate>
  );
}
