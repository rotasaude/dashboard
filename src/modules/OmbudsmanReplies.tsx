// Tela "Respostas à ouvidoria" (módulo 33; F-33.5): a caixa do ponto de resposta (`ombudsman_responder`). Só destino, extrato,
// prazo e estado: cada item é montado campo a campo na leitura, então protocolo, texto original, assunto, identidade e anexos nunca
// entram no cache nem na tela, mesmo que o api um dia mande. O cache é de páginas (50, cursor `before`); o api ordena por data e a
// tela separa os pendentes (primeiro), sem reordenar dentro de cada grupo. Nada em storage.
import { useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { listOmbudsmanInbox, type OmbudsmanInboxItem } from "../lib/api";
import { NOMINAL_QUERY, OMBUDSMAN_ERRORS, OMB_INBOX_KEY, ombudsmanRefusals } from "../lib/ombudsman";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { EmptyState } from "../components/EmptyState";
import { alert, muted, row, stack } from "./exams/styles";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";
import { ReplyCard } from "./ombudsman/ReplyCard";

type InboxPage = { items: OmbudsmanInboxItem[]; next_before: string | null };

const NO_CONTACT = "A ouvidoria responde ao cidadão. Não entre em contato com quem fez a manifestação.";

function toItem(i: OmbudsmanInboxItem): OmbudsmanInboxItem {
  const item: OmbudsmanInboxItem = {
    id: i.id, destination: { kind: i.destination.kind, id: i.destination.id, name: i.destination.name }, extract: i.extract,
    due_on: i.due_on, color: i.color, state: i.state, created_at: i.created_at, extended: i.extended
  };
  if (typeof i.reply === "string" && i.reply !== "") item.reply = i.reply;
  return item;
}

function Inbox() {
  const queryClient = useQueryClient();
  const [ stale, setStale ] = useState(false);
  const inbox = useInfiniteQuery({
    queryKey: [ OMB_INBOX_KEY ],
    queryFn: async ({ pageParam }): Promise<InboxPage> => {
      const p = await listOmbudsmanInbox(pageParam ? { before: pageParam } : {});
      return { items: p.items.map(toItem), next_before: p.next_before };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const items = (inbox.data?.pages ?? []).flatMap((p) => p.items);
  const shown = [ ...items.filter((i) => i.state === "pending"), ...items.filter((i) => i.state !== "pending") ];

  // O item novo troca o antigo dentro da página em que estava.
  const done = (next: OmbudsmanInboxItem) => {
    setStale(false);
    const clean = toItem(next);
    queryClient.setQueryData<InfiniteData<InboxPage, string | null>>([ OMB_INBOX_KEY ], (old) => old && {
      ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === clean.id ? clean : i)) }))
    });
  };
  // O encaminhamento mudou ou saiu do destino: a frase fica e a lista é relida uma vez, sem desmontar os outros cartões.
  const gone = () => {
    setStale(true);
    void inbox.refetch();
  };

  return (
    <div style={stack}>
      <p style={muted}>{NO_CONTACT}</p>
      {stale && <p role="alert" style={alert}>{OMBUDSMAN_ERRORS.forwarding_changed}</p>}
      {inbox.isPending && <p className="mono" style={muted}>carregando…</p>}
      {inbox.isError && (
        <div style={row}>
          <p role="alert" style={alert}>{ombudsmanRefusals(inbox.error)[0].text}</p>
          {!inbox.data && <button type="button" style={secondaryButtonStyle} onClick={() => void inbox.refetch()}>Tentar de novo</button>}
        </div>
      )}
      {inbox.data && shown.length === 0 && <EmptyState title="Nenhum encaminhamento para o seu destino" />}
      {shown.map((i) => <ReplyCard key={i.id} item={i} onDone={done} onStale={gone} />)}
      {inbox.data && inbox.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>
            {inbox.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}

// A leitura só nasce depois do portão (interruptor e papel): sem o papel de respondente, a caixa nem é pedida.
export function OmbudsmanReplies() {
  return (
    <OmbudsmanGate title="Respostas à ouvidoria" sub="encaminhamentos do seu setor ou unidade" allow={(r) => r.responder}>
      {() => <Inbox />}
    </OmbudsmanGate>
  );
}
