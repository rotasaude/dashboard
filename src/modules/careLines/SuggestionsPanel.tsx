// src/modules/careLines/SuggestionsPanel.tsx
// Sugestões a confirmar (contrato §4; spec §2 decisões 2 e 8; ADR 0040): o
// sistema sugere (problema ativo, idade e sexo, condição declarada) e um
// profissional SEMPRE decide. Aceitar é só de médico ou enfermeiro
// (`can_confirm`, D2; o api recusa com cbo_not_allowed), escolhendo a equipe
// de referência; a linha da gestante pede a DUM (D3; 422 anchor_required abre
// o campo). Recusar pede motivo (1 a 500, D8). Problema resolvido sugere
// ENCERRAR (D4) e nunca encerra sozinho. A lista é NOMINAL com trilha: lida ao
// abrir a aba e depois de uma ação, nunca sozinha.
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { acceptCareSuggestion, dismissCareSuggestion, errorCode, listCareSuggestions, type CareSuggestion, type CareTeam } from "../../lib/api";
import {
  NOMINAL_QUERY, SUGGESTIONS_KEY, anchorProblem, careLineError, fmtDay, personName, reasonLabel, reasonProblem
} from "../../lib/careLines";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row, stack } from "../exams/styles";
import { useCareSubmit } from "./useCareSubmit";

type Acting = { kind: "accept" | "dismiss" | "end"; suggestion: CareSuggestion } | null;
type Done = (message: string) => void;

export function SuggestionsPanel({ teamId, careLineId, teams, canConfirm, today, onChanged }: {
  teamId: string; careLineId: string; teams: CareTeam[]; canConfirm: boolean; today: string; onChanged: Done;
}) {
  const query = useInfiniteQuery({
    queryKey: [ SUGGESTIONS_KEY, teamId, careLineId ],
    queryFn: ({ pageParam }) => listCareSuggestions({ teamId, careLineId: careLineId || undefined, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const rows = (query.data?.pages ?? []).flatMap((p) => p.suggestions);
  const [ acting, setActing ] = useState<Acting>(null);
  const finish: Done = (message) => { setActing(null); onChanged(message); };
  const act = (kind: "accept" | "dismiss" | "end", s: CareSuggestion) => setActing({ kind, suggestion: s });

  return (
    <Panel title="Sugestões a confirmar" sub="nada é inscrito sem um profissional confirmar">
      <div style={{ ...stack, padding: 16 }}>
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{careLineError(query.error)}</p>}
        {query.data && (
          <DataTable<CareSuggestion>
            cols={[
              { label: "Pessoa", w: "1.5fr", card: "title", render: (s) => `${personName(s.person)}${s.person.age !== null ? ` · ${s.person.age} anos` : ""}` },
              { label: "Linha", w: "1.2fr", render: (s) => s.care_line.name },
              { label: "Por quê", w: "1.6fr", render: (s) => reasonLabel(s.reason) },
              { label: "Desde", w: "100px", render: (s) => fmtDay(s.created_at) },
              {
                label: "Ação", w: "1.6fr", card: "actions", render: (s) => {
                  const name = personName(s.person);
                  if (s.reason === "resolved_problem") return (
                    <div style={row}>
                      <button type="button" style={buttonStyle} aria-label={`Encerrar inscrição de ${name}`} onClick={() => act("end", s)}>Encerrar inscrição</button>
                      <button type="button" style={secondaryButtonStyle} aria-label={`Manter inscrição de ${name}`} onClick={() => act("dismiss", s)}>Manter</button>
                    </div>
                  );
                  return (
                    <div style={row}>
                      {canConfirm && <button type="button" style={buttonStyle} aria-label={`Aceitar sugestão de ${name}`} onClick={() => act("accept", s)}>Aceitar</button>}
                      <button type="button" style={secondaryButtonStyle} aria-label={`Recusar sugestão de ${name}`} onClick={() => act("dismiss", s)}>Recusar</button>
                    </div>
                  );
                }
              }
            ]}
            rows={rows} rowKey={(s) => s.id} empty="nenhuma sugestão a confirmar"
          />
        )}
        {query.hasNextPage && (
          <div>
            <button type="button" style={secondaryButtonStyle} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Carregar mais</button>
          </div>
        )}
        {!canConfirm && <p style={muted}>Só médico ou enfermeiro confirma a inscrição; você pode recusar sugestões.</p>}
        {acting?.kind === "accept" && (
          <AcceptForm key={acting.suggestion.id} suggestion={acting.suggestion} teams={teams} teamId={teamId} today={today}
            onDone={finish} onCancel={() => setActing(null)} />
        )}
        {acting?.kind === "dismiss" && (
          <DismissForm key={acting.suggestion.id} suggestion={acting.suggestion} onDone={finish} onCancel={() => setActing(null)} />
        )}
        {acting?.kind === "end" && (
          <CloseForm key={acting.suggestion.id} suggestion={acting.suggestion} onDone={finish} onCancel={() => setActing(null)} />
        )}
      </div>
    </Panel>
  );
}

// Sugestão de encerramento (L5, P-dashboard-08): aceitar encerra a inscrição com "alta da linha" (discharge);
// vale para todo profissional com painel (como o "Encerrar" do detalhe), por isso não depende de can_confirm.
function CloseForm({ suggestion, onDone, onCancel }: { suggestion: CareSuggestion; onDone: Done; onCancel(): void }) {
  const name = personName(suggestion.person);
  const { busy, error, submit } = useCareSubmit();

  async function close() {
    const ok = await submit(() => acceptCareSuggestion(suggestion.id, {}), onDone);
    if (ok) onDone(`Inscrição de ${name} encerrada com alta.`);
  }

  return (
    <section aria-label={`Encerrar a inscrição de ${name}`} style={box}>
      <div style={form}>
        <strong>{`${name} · ${suggestion.care_line.name} · ${reasonLabel(suggestion.reason)}`}</strong>
        <p style={muted}>
          O problema que trouxe a pessoa para {suggestion.care_line.name} foi resolvido. Encerrar dá alta da linha; o histórico fica.
        </p>
        {error && <p role="alert" style={alert}>{error}</p>}
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void close()}>Encerrar com alta</button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}

function AcceptForm({ suggestion, teams, teamId, today, onDone, onCancel }: {
  suggestion: CareSuggestion; teams: CareTeam[]; teamId: string; today: string; onDone: Done; onCancel(): void;
}) {
  const name = personName(suggestion.person);
  // L5/P-dashboard-07: a sugestão já nasce numa equipe; a tela começa por ela.
  const [ team, setTeam ] = useState(suggestion.team_id ?? teamId);
  const [ lmp, setLmp ] = useState("");
  // P-dashboard-03: a DUM é pedida pela linha (`requires_anchor`); anchor_required do api também abre o campo.
  const [ needAnchor, setNeedAnchor ] = useState(suggestion.care_line.requires_anchor === "lmp");
  const { busy, error, setError, submit } = useCareSubmit();

  async function accept() {
    if (needAnchor) {
      const problem = anchorProblem(lmp, today);
      if (problem) { setError(problem); return; }
    }
    const body = needAnchor ? { team_id: team, anchor_date: lmp } : { team_id: team };
    const ok = await submit(async () => {
      try {
        await acceptCareSuggestion(suggestion.id, body);
      } catch (err) {
        if (errorCode(err) === "anchor_required") setNeedAnchor(true);
        throw err;
      }
    }, onDone);
    if (ok) onDone(`Inscrição de ${name} em ${suggestion.care_line.name} confirmada.`);
  }

  return (
    <section aria-label={`Aceitar ${name} em ${suggestion.care_line.name}`} style={box}>
      <div style={form}>
        <strong>{`${name} · ${suggestion.care_line.name} · ${reasonLabel(suggestion.reason)}`}</strong>
        <p style={muted}>A inscrição é um ato clínico: confirme depois de conferir o motivo da sugestão.</p>
        <label style={fieldLabel}>
          Equipe de referência
          <select value={team} style={inputStyle} onChange={(e) => { setError(null); setTeam(e.target.value); }}>
            {teams.map((t) => <option key={t.id} value={t.id}>{`${t.name} · INE ${t.ine}`}</option>)}
          </select>
        </label>
        {needAnchor && (
          <label style={fieldLabel}>
            DUM (data da última menstruação)
            <input type="date" value={lmp} style={inputStyle} onChange={(e) => { setError(null); setLmp(e.target.value); }} />
          </label>
        )}
        {error && <p role="alert" style={alert}>{error}</p>}
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void accept()}>Confirmar inscrição</button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}

function DismissForm({ suggestion, onDone, onCancel }: { suggestion: CareSuggestion; onDone: Done; onCancel(): void }) {
  const name = personName(suggestion.person);
  const keep = suggestion.reason === "resolved_problem";
  const [ reason, setReason ] = useState("");
  const { busy, error, setError, submit } = useCareSubmit();

  async function dismiss() {
    const problem = reasonProblem(reason);
    if (problem) { setError(problem); return; }
    // O motivo vai só no corpo (P20); o api guarda o texto aparado.
    const ok = await submit(() => dismissCareSuggestion(suggestion.id, reason.trim()), onDone);
    if (ok) onDone(keep ? `Inscrição de ${name} mantida.` : `Sugestão de ${name} recusada.`);
  }

  return (
    <section aria-label={keep ? `Manter a inscrição de ${name}` : `Recusar a sugestão de ${name}`} style={box}>
      <div style={form}>
        <strong>{`${name} · ${suggestion.care_line.name} · ${reasonLabel(suggestion.reason)}`}</strong>
        <label style={fieldLabel}>
          {keep ? "Por que manter a inscrição" : "Motivo da recusa"}
          <textarea rows={2} value={reason} style={inputStyle} onChange={(e) => { setError(null); setReason(e.target.value); }} />
        </label>
        <p style={muted}>até 500 caracteres; fica no registro da decisão, o cidadão não vê</p>
        {error && <p role="alert" style={alert}>{error}</p>}
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void dismiss()}>{keep ? "Manter inscrição" : "Recusar sugestão"}</button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}
