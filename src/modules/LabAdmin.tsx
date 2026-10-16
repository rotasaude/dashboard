// src/modules/LabAdmin.tsx
// Admin do laboratório municipal (spec §7 "Admin"; contrato §3): por
// laboratório (prestador com `uses_municipal_lab`), exames e versões;
// motivos de rejeição, liberadores e o token do middleware.
// O administrador não passa pelo contexto do laboratório (`needsLab={false}`):
// a tela lê os prestadores e tem estado vazio próprio.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listExamProviders } from "../lib/api";
import { EXAM_ADMIN_PROVIDERS_KEY } from "../lib/exams";
import { labError } from "../lib/lab";
import { labProviders } from "../lib/labAdmin";
import { EmptyState } from "../components/EmptyState";
import { inputStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabExamsPanel } from "./labAdmin/LabExamsPanel";
import { RejectionReasonsPanel } from "./labAdmin/RejectionReasonsPanel";
import { ReleasersPanel } from "./labAdmin/ReleasersPanel";
import { MiddlewareTokenPanel } from "./labAdmin/MiddlewareTokenPanel";
import { alert, fieldLabel, muted, stack } from "./exams/styles";

export function LabAdmin({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <LabGate title="Exames e liberadores do laboratório" sub="cidade · laboratório municipal" allow={(r) => r.admin} needsLab={false}>
      {() => <AdminBody onGoToSecurity={onGoToSecurity} />}
    </LabGate>
  );
}

function AdminBody({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: [ EXAM_ADMIN_PROVIDERS_KEY ], queryFn: listExamProviders, retry: false });
  const [ providerId, setProviderId ] = useState("");
  if (providers.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (providers.isError && !providers.data) return <p role="alert" style={alert}>{labError(providers.error)}</p>;
  const labs = labProviders(providers.data!);
  if (labs.length === 0) {
    return <EmptyState title="nenhum prestador usa o laboratório municipal" sub="marque o laboratório em Exames → Catálogo e prestadores" />;
  }
  const lab = labs.find((l) => l.id === providerId) ?? labs[0];
  return (
    <div style={stack}>
      {labs.length > 1 && (
        <label style={fieldLabel}>Laboratório
          <select value={lab.id} style={inputStyle} onChange={(e) => setProviderId(e.target.value)}>
            {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      )}
      <LabExamsPanel key={lab.id} providerId={lab.id} onGoToSecurity={onGoToSecurity} />
      <RejectionReasonsPanel key={`r-${lab.id}`} providerId={lab.id} onGoToSecurity={onGoToSecurity} />
      <ReleasersPanel key={`l-${lab.id}`} providerId={lab.id} onGoToSecurity={onGoToSecurity} />
      <MiddlewareTokenPanel key={`m-${lab.id}`} provider={lab} onGoToSecurity={onGoToSecurity}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: [ EXAM_ADMIN_PROVIDERS_KEY ] })} />
    </div>
  );
}
