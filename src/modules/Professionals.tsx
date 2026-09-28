import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createProfessional, listPendingProfessionals, listProfessionals, type PendingProfessional } from "../lib/api";
import { STATUS_LABEL, professionalError } from "../lib/professionals";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { ProfileForm } from "./professionals/ProfileForm";
import { ProfessionalDetail } from "./professionals/ProfessionalDetail";

// Profissionais (módulo 10; spec 2026-09-27 §5): só municipal_admin. Lista,
// painel de quem tem o papel sem cadastro completo e ficha por profissional.
export function Professionals() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [ "professionals" ], queryFn: listProfessionals });
  const pending = useQuery({ queryKey: [ "professionalsPending" ], queryFn: listPendingProfessionals });
  const [ creatingFor, setCreatingFor ] = useState<PendingProfessional | null>(null);
  const [ openId, setOpenId ] = useState<string | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [ "professionals" ] });
    void queryClient.invalidateQueries({ queryKey: [ "professionalsPending" ] });
  }

  if (openId) {
    return <ProfessionalDetail professionalId={openId} onBack={() => { setOpenId(null); refresh(); }} />;
  }

  const byUser = new Map((list.data ?? []).map((p) => [ p.user_id, p.id ]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Profissionais" sub="perfil · vínculos · turnos" />

      {(pending.data?.length ?? 0) > 0 && (
        <Panel title="Com papel, sem cadastro completo" sub="não chamam pacientes até ter perfil e vínculo">
          <DataTable<PendingProfessional>
            cols={[
              { label: "Usuário", w: "2fr", render: (u) => <span className="mono">{u.email_address}</span> },
              { label: "Situação", w: "1fr", render: (u) => <Tag tone="warn">{STATUS_LABEL[u.status]}</Tag> },
              { label: "", w: "auto", align: "right", render: (u) => u.status === "missing_profile"
                ? <button type="button" style={buttonStyle} onClick={() => setCreatingFor(u)}>Cadastrar perfil</button>
                : <button type="button" style={secondaryButtonStyle} onClick={() => setOpenId(byUser.get(u.user_id) ?? null)}>Vincular</button> }
            ]}
            rows={pending.data ?? []}
            rowKey={(u) => u.user_id}
          />
        </Panel>
      )}

      {creatingFor && (
        <Panel title={`Perfil de ${creatingFor.email_address}`} right={
          <button type="button" style={secondaryButtonStyle} onClick={() => setCreatingFor(null)}>Fechar</button>
        }>
          <ProfileForm submitLabel="Salvar perfil" onSubmit={async (fields) => {
            const created = await createProfessional(creatingFor.user_id, fields);
            setCreatingFor(null);
            refresh();
            setOpenId(created.id);
          }} />
        </Panel>
      )}

      <Panel title="Cadastrados">
        {list.error ? <p role="alert">{professionalError(list.error)}</p> : (list.data ?? []).length === 0
          ? <EmptyState title="nenhum profissional cadastrado" />
          : (
            <DataTable
              cols={[
                { label: "Nome", w: "2fr", render: (p) => (
                  <button type="button" onClick={() => setOpenId(p.id)} style={{ ...secondaryButtonStyle, border: "none" }}>
                    {p.professional_name}
                  </button>
                ) },
                { label: "Conselho", w: "1fr", render: (p) => `${p.council}-${p.council_state} ${p.registration_number}` },
                { label: "Vínculos ativos", w: "3fr", render: (p) => (
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {p.links.filter((l) => !l.ended_at).map((l) => <Tag key={l.id} mono={false}>{`${l.unit_name} · ${l.cbo_title ?? l.cbo_code}`}</Tag>)}
                  </span>
                ) }
              ]}
              rows={list.data ?? []}
              rowKey={(p) => p.id}
            />
          )}
      </Panel>
    </div>
  );
}
