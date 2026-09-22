import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { grantRole, listMemberships, revokeMembership } from "../lib/api";
import { describeActionError } from "../lib/actionErrors";
import { REQUIRED_REVIEWERS, REVIEWER_ROLE, reviewerCount, teamMembers, type TeamMember } from "../lib/team";
import { useAuth } from "../lib/auth";
import { SensitiveAction } from "../components/SensitiveAction";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { buttonStyle } from "../components/formStyles";
import type { ModuleId } from "../shell/modules";

// Equipe (spec do dashboard §5.2). Só municipal_admin chega aqui — a API
// recusa o resto com 403, e o item de menu já não aparece (navGroupsFor).
//
// Escopo: conceder e revogar APENAS protocol_reviewer. Convidar membro,
// outros papéis e desativar usuário são de outro spec (§10).
//
// Quem traduz recusa da API e cuida do código TOTP é o SensitiveAction; esta
// tela não tenta interpretar erro de ação por conta própria.
const NO_REVIEWERS_WARNING = "sem 2 revisores, nenhum protocolo é publicado ou ativado nesta cidade";
const GENERIC_ERROR = "não foi possível carregar — tente de novo";

type Pending = { member: TeamMember; kind: "grant" | "revoke" };

function loadErrorMessage(err: unknown): string {
  const described = describeActionError(err);
  return "message" in described ? described.message : GENERIC_ERROR;
}

export function Team({ onNavigate }: { onNavigate(id: ModuleId): void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ "memberships" ], queryFn: listMemberships });
  const [ pending, setPending ] = useState<Pending | null>(null);
  const [ done, setDone ] = useState<string | null>(null);

  const members = teamMembers(query.data ?? []);
  const reviewers = reviewerCount(members);

  function open(member: TeamMember, kind: Pending["kind"]) {
    setPending({ member, kind });
    setDone(null);
  }

  function finish(message: string) {
    setPending(null);
    setDone(message);
    void queryClient.invalidateQueries({ queryKey: [ "memberships" ] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Equipe" sub="papéis · revisores de protocolo" />

      {query.isLoading && <Panel title="Pessoas"><Skeleton rows={4} /></Panel>}
      {query.isError && <ErrorState message={loadErrorMessage(query.error)} />}

      {query.isSuccess && (
        <Panel title="Pessoas" sub="papéis ativos">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {done && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{done}</p>}
            {reviewers < REQUIRED_REVIEWERS && (
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{NO_REVIEWERS_WARNING}</p>
            )}

            {members.length === 0 ? <EmptyState title="nenhuma pessoa com papel ativo" /> : (
              <DataTable<TeamMember>
                cols={[
                  { label: "E-mail", w: "2fr", render: (m) => (
                    <span className="mono">{m.email}{m.userId === user?.id ? " (você)" : ""}</span>
                  ) },
                  { label: "Papéis", w: "2fr", render: (m) => (
                    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                      {m.roles.map((role) => <Tag key={role}>{role}</Tag>)}
                    </span>
                  ) },
                  { label: "Revisor", w: "auto", align: "right", render: (m) => (
                    m.isReviewer
                      ? <button type="button" style={buttonStyle} onClick={() => open(m, "revoke")}>Remover revisor</button>
                      : <button type="button" style={buttonStyle} onClick={() => open(m, "grant")}>Tornar revisor</button>
                  ) }
                ]}
                rows={members}
                rowKey={(m) => m.userId}
              />
            )}
          </div>
        </Panel>
      )}

      {pending && (
        pending.kind === "grant" ? (
          <SensitiveAction
            title="Tornar revisor"
            description={`${pending.member.email} poderá assinar publicação e ativação de protocolo.`}
            requiresStepUp
            run={async () => { await grantRole(pending.member.userId, REVIEWER_ROLE); }}
            onDone={() => finish(`${pending.member.email} agora é revisor`)}
            onCancel={() => setPending(null)}
            onGoToSecurity={() => onNavigate("security")}
          />
        ) : (
          // O `!` é seguro: "Remover revisor" só existe quando isReviewer é
          // true, e teamMembers preenche isReviewer e reviewerMembershipId
          // juntos (src/lib/team.ts).
          <SensitiveAction
            title="Remover revisor"
            description={`${pending.member.email} deixa de assinar protocolos. As assinaturas que já deu continuam valendo.`}
            requiresStepUp
            run={async () => { await revokeMembership(pending.member.reviewerMembershipId!); }}
            onDone={() => finish(`${pending.member.email} não é mais revisor`)}
            onCancel={() => setPending(null)}
            onGoToSecurity={() => onNavigate("security")}
          />
        )
      )}
    </div>
  );
}
