// Selo da sessão de assinatura no topo (módulo 19b; spec §5 "Sessão do
// turno" e §9; contrato §4). Mostra até quando a sessão vale e muda sozinho
// quando ela vence (relógio de 30 s, releitura de 1 min). Abrir vai ao
// prestador e volta para a tela de onde saiu (return_to "/<módulo>").
import { useEffect, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { closeSignatureSession, errorCode, getSignatureSession, openSignatureSession } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  SESSION_KEY, SIMULATED_NOTICE, canSign, goToProvider, isSimulatedProvider, sessionBadge, signatureError, usesSimulatedPsc
} from "../lib/signature";
import { Tag } from "../components/Tag";
import type { ModuleId } from "./modules";

const TICK_MS = 30_000;
const REFRESH_MS = 60_000;

interface Props {
  active: ModuleId;
  onSelect(id: ModuleId): void;
  redirect?(url: string): void;
}

export function SignatureSessionBadge({ active, onSelect, redirect = goToProvider }: Props) {
  const { user } = useAuth();
  const allowed = canSign(user);
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: [ SESSION_KEY, user?.id ], queryFn: getSignatureSession, enabled: allowed,
    refetchInterval: allowed ? REFRESH_MS : false
  });
  const [ now, setNow ] = useState(() => Date.now());
  const [ failure, setFailure ] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [ allowed ]);

  const open = useMutation({
    mutationFn: () => openSignatureSession(`/${active}`),
    onMutate: () => setFailure(null),
    onSuccess: ({ authorize_url }) => redirect(authorize_url),
    onError: (err) => {
      if (errorCode(err) === "certificate_not_linked") { onSelect("signature"); return; }
      setFailure(signatureError(err));
    }
  });

  const close = useMutation({
    mutationFn: closeSignatureSession,
    onMutate: () => setFailure(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [ SESSION_KEY ] }),
    onError: (err) => setFailure(signatureError(err))
  });

  if (!allowed || !session.isSuccess) return null;
  const badge = sessionBadge(session.data, now);
  const simulated = usesSimulatedPsc(user) || (badge.active && isSimulatedProvider(session.data.provider));

  return (
    <span aria-label="sessão de assinatura" style={wrap}>
      <Tag tone={badge.active ? "ok" : "neutral"}>{badge.label}</Tag>
      {simulated && <Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag>}
      {badge.active ? (
        <button type="button" disabled={close.isPending} style={linkButton} onClick={() => close.mutate()}>encerrar</button>
      ) : (
        <button type="button" disabled={open.isPending} style={linkButton} onClick={() => open.mutate()}>abrir sessão</button>
      )}
      {failure && <span role="alert" style={alert}>{failure}</span>}
    </span>
  );
}

const wrap: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 };
const linkButton: CSSProperties = {
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 11.5,
  color: "var(--accent)", textDecoration: "underline", whiteSpace: "nowrap"
};
const alert: CSSProperties = { fontSize: 11, color: "var(--down)", maxWidth: 240 };
