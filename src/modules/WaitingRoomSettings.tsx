// Módulo 32a: senhas, locais e TVs (casca; o conteúdo vem na Task 11). Portão: interruptor e papel.
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { useAuth } from "../lib/auth";
import { canUseWaitingRoom, WAITING_ROOM_DISABLED } from "../lib/urgency";
import { stack } from "./exams/styles";

export const WAITING_ROOM_NO_ROLE = "você não tem acesso às TVs e locais da sala de espera";

export function WaitingRoomSettings(_props: { onGoToSecurity: () => void }) {
  const { user } = useAuth();
  if (!user) return null;
  const isAdmin = user.memberships.some((m) => m.role === "municipal_admin");
  let body;
  if (!canUseWaitingRoom(user)) body = <EmptyState title={WAITING_ROOM_DISABLED} />;
  else if (!isAdmin) body = <EmptyState title={WAITING_ROOM_NO_ROLE} />;
  else body = <EmptyState title="Senhas, locais e TVs em construção" />;
  return (
    <div style={stack}>
      <PageHeader title="Senhas, locais e TVs" sub="Sala de espera" />
      {body}
    </div>
  );
}
