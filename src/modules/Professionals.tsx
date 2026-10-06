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
import { AppointmentTypes } from "./professionals/AppointmentTypes";
import { SegmentedControl } from "../shell/SegmentedControl";

// Módulo 17: tipos de atendimento e modelos de agenda moram aqui, com o
// mesmo papel (municipal_admin) da lista de profissionais.
type ProfessionalsTab = "people" | "types";
const TABS: { key: ProfessionalsTab; label: string }[] = [
  { key: "people", label: "Profissionais" },
  { key: "types", label: "Tipos de atendimento" }
];

export function Professionals() {
  const [ tab, setTab ] = useState<ProfessionalsTab>("people");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div><SegmentedControl options={TABS} value={tab} onChange={setTab} /></div>
      {tab === "people" && <People />}
      {tab === "types" && <AppointmentTypes />}
    </div>
  );
}

// Profissionais (módulo 10; spec 2026-09-27 §5): só municipal_admin. Lista,
// painel de quem tem o papel sem cadastro completo e ficha por profissional.
function People() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [ "professionals" ], queryFn: listProfessionals });
  const pending = useQuery({ queryKey: [ "professionalsPending" ], queryFn: listPendingProfessionals });
  const [ creatingFor, setCreatingFor ] = useState<PendingProfessional | null>(null);
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ linkNotFound, setLinkNotFound ] = useState(false);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [ "professionals" ] });
    void queryClient.invalidateQueries({ queryKey: [ "professionalsPending" ] });
  }

  if (openId) {
    return <ProfessionalDetail professionalId={openId} onBack={() => { setOpenId(null); refresh(); }} />;
  }

  const byUser = new Map((list.data ?? []).map((p) => [ p.user_id, p.id ]));

  // "Vincular" espera que o profissional já esteja em `listProfessionals`
  // (perfil cadastrado, só falta o vínculo). Se as consultas estiverem fora
  // de sincronia — a lista ainda não trouxe o perfil recém-criado noutra
  // aba, por exemplo — não faça nada em silêncio: avise e recarregue ambas.
  function handleVincular(userId: string) {
    const id = byUser.get(userId);
    if (id) { setLinkNotFound(false); setOpenId(id); return; }
    setLinkNotFound(true);
    refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Profissionais" sub="perfil · vínculos · turnos" />

      {pending.isError && (
        <Panel title="Com papel, sem cadastro completo">
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{professionalError(pending.error)}</p>
        </Panel>
      )}

      {!pending.isError && (pending.data?.length ?? 0) > 0 && (
        <Panel title="Com papel, sem cadastro completo" sub="não chamam pacientes até ter perfil e vínculo">
          {linkNotFound && (
            <p role="alert" style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--down)" }}>
              perfil não encontrado na lista — recarregando
            </p>
          )}
          <DataTable<PendingProfessional>
            cols={[
              { label: "Usuário", w: "2fr", render: (u) => <span className="mono">{u.email_address}</span> },
              { label: "Situação", w: "1fr", render: (u) => <Tag tone="warn">{STATUS_LABEL[u.status]}</Tag> },
              { label: "", w: "auto", align: "right", render: (u) => u.status === "missing_profile"
                ? <button type="button" style={buttonStyle} onClick={() => setCreatingFor(u)}>Cadastrar perfil</button>
                : <button type="button" style={secondaryButtonStyle} onClick={() => handleVincular(u.user_id)}>Vincular</button> }
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
        {list.isError ? <p role="alert">{professionalError(list.error)}</p> : list.isLoading
          ? <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
          : (list.data ?? []).length === 0
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
                { label: "Vínculos ativos", w: "3fr", render: (p) => {
                  const active = p.links.filter((l) => !l.ended_at);
                  if (active.length === 0) return <Tag tone="warn">{STATUS_LABEL.missing_link}</Tag>;
                  return (
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {active.map((l) => <Tag key={l.id} mono={false}>{`${l.unit_name} · ${l.cbo_title ?? l.cbo_code}`}</Tag>)}
                    </span>
                  );
                } }
              ]}
              rows={list.data ?? []}
              rowKey={(p) => p.id}
            />
          )}
      </Panel>
    </div>
  );
}
