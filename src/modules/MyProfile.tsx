import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyProfessional, updateMyProfessional, type ProfessionalLink, type ProfessionalShift } from "../lib/api";
import { professionalError } from "../lib/professionals";
import { fmtDateTime } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { KeyValue } from "../components/KeyValue";
import { EmptyState } from "../components/EmptyState";
import { ProfileForm } from "./professionals/ProfileForm";

// Meu perfil (módulo 10; emenda ao ADR 0021): o profissional lê conselho,
// registro, CNS, vínculos e turnos e edita só nome e contato.
export function MyProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Chave por usuário (F-10.5) — ver o comentário em Attendance.tsx: o
  // QueryClient sobrevive a troca de sessão na mesma aba.
  const query = useQuery({ queryKey: [ "myProfessional", user?.id ?? null ], queryFn: getMyProfessional });

  if (query.error) return <p role="alert">{professionalError(query.error)}</p>;
  if (query.isLoading) return null;
  if (!query.data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <PageHeader title="Meu perfil" sub="profissional de saúde" />
        <EmptyState title="Seu cadastro profissional ainda não foi feito. Fale com a administração da cidade." />
      </div>
    );
  }

  const { professional, links, shifts } = query.data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Meu perfil" sub={professional.email_address} />
      <Panel title="Dados conferidos pela prefeitura">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <KeyValue k="Conselho" v={`${professional.council}-${professional.council_state} ${professional.registration_number}`} />
          <KeyValue k="CNS" v={professional.cns_masked} />
        </div>
      </Panel>
      <Panel title="Nome e contato">
        <ProfileForm initial={professional} selfService submitLabel="Salvar" onSubmit={async (fields) => {
          await updateMyProfessional({ professional_name: fields.professional_name, phone: fields.phone ?? null,
            contact_email: fields.contact_email ?? null });
          void queryClient.invalidateQueries({ queryKey: [ "myProfessional", user?.id ?? null ] });
        }} />
      </Panel>
      <Panel title="Vínculos ativos">
        <DataTable<ProfessionalLink>
          cols={[ { label: "Vínculo", w: "1fr", render: (l) => `${l.unit_name} · ${l.cbo_title ?? l.cbo_code}` } ]}
          rows={links} rowKey={(l) => l.id} empty="nenhum vínculo ativo — você não chama pacientes"
        />
      </Panel>
      <Panel title="Próximos turnos" sub="14 dias">
        <DataTable<ProfessionalShift>
          cols={[
            { label: "Unidade", w: "2fr", render: (s) => s.unit_name },
            { label: "Início", w: "1fr", render: (s) => fmtDateTime(s.starts_at) },
            { label: "Fim", w: "1fr", render: (s) => fmtDateTime(s.ends_at) }
          ]}
          rows={shifts} rowKey={(s) => s.id} empty="nenhum turno lançado"
        />
      </Panel>
    </div>
  );
}
