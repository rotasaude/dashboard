import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { deactivateUser, grantRole, inviteMember, listMemberships, revokeMembership, type Invitation } from "../lib/api";
import { describeActionError } from "../lib/actionErrors";
import {
  INVITE_ROLES, PROFESSIONAL_ROLE, REQUIRED_REVIEWERS, REVIEWER_ROLE, VERIFIER_ROLE, deactivateErrorMessage,
  inviteErrorMessage, isPrivilegedRole, isValidEmail, reviewerCount, teamMembers, type TeamMember
} from "../lib/team";
import { STATUS_LABEL } from "../lib/professionals";
import { fmtDateTime } from "../lib/format";
import { useAuth } from "../lib/auth";
import { SensitiveAction } from "../components/SensitiveAction";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { Skeleton } from "../components/Skeleton";
import { buttonStyle, inputStyle } from "../components/formStyles";
import type { ModuleId } from "../shell/modules";

// Equipe (spec do dashboard §5.2). Só municipal_admin chega aqui — a API
// recusa o resto com 403, e o item de menu já não aparece (navGroupsFor).
//
// Escopo: conceder e revogar revisor, atendente e profissional de saúde;
// convidar pessoa com qualquer um dos 7 papéis (step-up só nos privilegiados,
// como na API); desativar usuário (sempre com step-up, nunca a si mesmo).
// Convite e Desativar só aparecem para municipal_admin — a API também recusa.
// A pessoa desativada some da lista: a API só lista usuários ativos.
//
// Quem cuida do código TOTP e da repetição após mfa_required é o
// SensitiveAction; as frases das recusas próprias de convite e desativação
// vêm de src/lib/team.ts (translateError).
const NO_REVIEWERS_WARNING = "sem 2 revisores, nenhum protocolo é publicado ou ativado nesta cidade";
const GENERIC_ERROR = "não foi possível carregar — tente de novo";

type Pending = { member: TeamMember; kind: "grant" | "revoke"; role: "reviewer" | "verifier" | "professional" };
type Invite = { email: string; role: string };
const INVALID_EMAIL = "informe um e-mail válido";

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
  const [ deactivating, setDeactivating ] = useState<TeamMember | null>(null);
  const [ inviteEmail, setInviteEmail ] = useState("");
  const [ inviteRole, setInviteRole ] = useState(INVITE_ROLES[0].role);
  const [ inviteError, setInviteError ] = useState<string | null>(null);
  const [ inviting, setInviting ] = useState<Invite | null>(null);
  const sentInvitation = useRef<Invitation | null>(null);

  const isAdmin = user?.memberships?.some((m) => m.role === "municipal_admin") ?? false;

  const members = teamMembers(query.data ?? []);
  const reviewers = reviewerCount(members);

  function closeAll() {
    setPending(null);
    setDeactivating(null);
    setInviting(null);
  }

  function open(member: TeamMember, kind: Pending["kind"], role: Pending["role"]) {
    closeAll();
    setPending({ member, kind, role });
    setDone(null);
  }

  function openDeactivate(member: TeamMember) {
    closeAll();
    setDeactivating(member);
    setDone(null);
  }

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!isValidEmail(email)) { setInviteError(INVALID_EMAIL); return; }
    setInviteError(null);
    closeAll();
    setDone(null);
    setInviting({ email, role: inviteRole });
  }

  function finish(message: string) {
    closeAll();
    setDone(message);
    void queryClient.invalidateQueries({ queryKey: [ "memberships" ] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Equipe" sub="papéis · revisores de protocolo · atendentes" />

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
                      {m.professionalStatus && m.professionalStatus !== "ok" && (
                        <button
                          type="button"
                          onClick={() => onNavigate("professionals")}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        >
                          <Tag tone="warn">{STATUS_LABEL[m.professionalStatus]}</Tag>
                        </button>
                      )}
                    </span>
                  ) },
                  { label: "Revisor", w: "auto", align: "right", render: (m) => (
                    m.isReviewer
                      ? <button type="button" style={buttonStyle} onClick={() => open(m, "revoke", "reviewer")}>Remover revisor</button>
                      : <button type="button" style={buttonStyle} onClick={() => open(m, "grant", "reviewer")}>Tornar revisor</button>
                  ) },
                  { label: "Atendente", w: "auto", align: "right", render: (m) => (
                    m.isVerifier
                      ? <button type="button" style={buttonStyle} onClick={() => open(m, "revoke", "verifier")}>Remover atendente</button>
                      : <button type="button" style={buttonStyle} onClick={() => open(m, "grant", "verifier")}>Tornar atendente</button>
                  ) },
                  { label: "Profissional de saúde", w: "auto", align: "right", render: (m) => (
                    m.isProfessional
                      ? <button type="button" style={buttonStyle} onClick={() => open(m, "revoke", "professional")}>Remover profissional de saúde</button>
                      : <button type="button" style={buttonStyle} onClick={() => open(m, "grant", "professional")}>Tornar profissional de saúde</button>
                  ) },
                  ...(isAdmin ? [ { label: "Acesso", w: "auto", align: "right" as const, render: (m: TeamMember) => (
                    m.userId === user?.id
                      ? null
                      : <button type="button" style={buttonStyle} onClick={() => openDeactivate(m)}>Desativar</button>
                  ) } ] : [])
                ]}
                rows={members}
                rowKey={(m) => m.userId}
              />
            )}
          </div>
        </Panel>
      )}

      {isAdmin && (
        <Panel title="Convidar pessoa" sub="o convite chega por e-mail">
          <form onSubmit={submitInvite} noValidate
            style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={inviteLabel}>
              E-mail da pessoa
              <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={inputStyle} />
            </label>
            <label style={inviteLabel}>
              Papel
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={inputStyle}>
                {INVITE_ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
              </select>
            </label>
            <button type="submit" style={buttonStyle}>Convidar</button>
          </form>
          {inviteError && <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--down)" }}>{inviteError}</p>}
        </Panel>
      )}

      {inviting && (
        <SensitiveAction
          key={`${inviting.email}:${inviting.role}`}
          title="Convidar pessoa"
          description={`Convidar ${inviting.email} como ${roleLabel(inviting.role)}.`}
          requiresStepUp={isPrivilegedRole(inviting.role)}
          confirmLabel="Enviar convite"
          run={async () => { sentInvitation.current = await inviteMember(inviting.email, inviting.role); }}
          onDone={() => {
            const inv = sentInvitation.current;
            setInviteEmail("");
            finish(`Convite enviado para ${inv?.email ?? inviting.email} — válido até ${fmtDateTime(inv?.expires_at)}`);
          }}
          onCancel={() => setInviting(null)}
          onGoToSecurity={() => onNavigate("security")}
          translateError={inviteErrorMessage}
        />
      )}

      {deactivating && (
        <SensitiveAction
          key={deactivating.userId}
          title="Desativar acesso"
          description={`Desativar ${deactivating.email}? A pessoa perde o acesso e as sessões abertas são encerradas.`}
          requiresStepUp
          confirmLabel="Confirmar desativação"
          run={async () => { await deactivateUser(deactivating.userId); }}
          onDone={() => finish(`${deactivating.email} foi desativado(a)`)}
          onCancel={() => setDeactivating(null)}
          onGoToSecurity={() => onNavigate("security")}
          translateError={deactivateErrorMessage}
        />
      )}

      {pending && pending.role === "reviewer" && (
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

      {pending && pending.role === "verifier" && (
        pending.kind === "grant" ? (
          <SensitiveAction
            title="Tornar atendente"
            description={`${pending.member.email} poderá validar cadastros de cidadãos no balcão da UBS.`}
            requiresStepUp
            run={async () => { await grantRole(pending.member.userId, VERIFIER_ROLE); }}
            onDone={() => finish(`${pending.member.email} agora é atendente`)}
            onCancel={() => setPending(null)}
            onGoToSecurity={() => onNavigate("security")}
          />
        ) : (
          // O `!` é seguro: "Remover atendente" só existe quando isVerifier é
          // true, e teamMembers preenche isVerifier e verifierMembershipId
          // juntos (src/lib/team.ts).
          <SensitiveAction
            title="Remover atendente"
            description={`${pending.member.email} deixa de validar cadastros. As validações que já fez continuam valendo.`}
            requiresStepUp
            run={async () => { await revokeMembership(pending.member.verifierMembershipId!); }}
            onDone={() => finish(`${pending.member.email} não é mais atendente`)}
            onCancel={() => setPending(null)}
            onGoToSecurity={() => onNavigate("security")}
          />
        )
      )}

      {pending && pending.role === "professional" && (
        pending.kind === "grant" ? (
          <SensitiveAction
            title="Tornar profissional de saúde"
            description={`${pending.member.email} poderá chamar e registrar o desfecho de atendimentos na fila.`}
            requiresStepUp
            run={async () => { await grantRole(pending.member.userId, PROFESSIONAL_ROLE); }}
            onDone={() => finish(`${pending.member.email} agora é profissional de saúde`)}
            onCancel={() => setPending(null)}
            onGoToSecurity={() => onNavigate("security")}
          />
        ) : (
          // O `!` é seguro: "Remover profissional de saúde" só existe quando
          // isProfessional é true, e teamMembers preenche isProfessional e
          // professionalMembershipId juntos (src/lib/team.ts).
          <SensitiveAction
            title="Remover profissional de saúde"
            description={`${pending.member.email} deixa de atender na fila. Os atendimentos que já fez continuam valendo.`}
            requiresStepUp
            run={async () => { await revokeMembership(pending.member.professionalMembershipId!); }}
            onDone={() => finish(`${pending.member.email} não é mais profissional de saúde`)}
            onCancel={() => setPending(null)}
            onGoToSecurity={() => onNavigate("security")}
          />
        )
      )}
    </div>
  );
}

function roleLabel(role: string): string {
  return INVITE_ROLES.find((r) => r.role === role)?.label ?? role;
}

const inviteLabel = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)", minWidth: 220 };
