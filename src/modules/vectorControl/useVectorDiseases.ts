// src/modules/vectorControl/useVectorDiseases.ts
// Os rótulos das doenças do 35a (Q38): GET /vector_control/diseases, uma leitura por cache (STATIC_QUERY, compartilhada entre as
// telas e os componentes), só para quem a lê (canReadVectorDiseases: coordenação e municipal_admin). Sem a lista — carregando,
// falha ou sem papel — o código aparece cru e nenhum erro é mostrado: o rótulo é ajuda, não condição. `staleTime: Infinity` e
// `retryOnMount: false`: os componentes que montam depois (o detalhe do bloqueio, o cartão da tarefa) usam o mesmo cache.
import { useQuery } from "@tanstack/react-query";
import { getVectorDiseases } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { STATIC_QUERY, VC_DISEASES_KEY, canReadVectorDiseases, diseaseGroupLabel, diseaseName, vectorRoles } from "../../lib/vectorControl";

export function useVectorDiseases() {
  const { user } = useAuth();
  const enabled = !!user && canReadVectorDiseases(vectorRoles(user));
  // Uma leitura por sessão de tela: outro componente que monta depois não relê, nem depois de falha (o rótulo não muda no uso).
  const q = useQuery({ queryKey: [ VC_DISEASES_KEY ], queryFn: getVectorDiseases, enabled, ...STATIC_QUERY, staleTime: Infinity, retryOnMount: false });
  const data = q.data ?? null;
  return { disease: (code: string) => diseaseName(data, code), group: (code: string) => diseaseGroupLabel(data, code) };
}
