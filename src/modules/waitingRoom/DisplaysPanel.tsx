// Módulo 32a (F-32.5, F-32.1): TVs da sala de espera de uma unidade, só do municipal_admin. Nome de 1 a 60 (WaitingRoom::SaveDisplay).
// As quatro escritas (cadastrar, gerar código, revogar, mudar a TV) passam pelo step-up (SensitiveAction; preflight C, Task 11).
// O código de pareamento (6 dígitos, texto: o zero da frente conta) vale 10 min e uma vez; ele mora só na memória deste componente:
// nunca em storage, URL, hash ou console. Some ao gerar outro, ao revogar ou desativar a TV, ao vencer e ao sair da tela. A lista não
// é polida ("visto há N min" é o que o api disse na leitura). Tempos por cor (Q8): só na UPA, com o interruptor da unidade e o da TV.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPairingCode, createWaitingRoomDisplay, errorCode, listWaitingRoomDisplays, revokeWaitingRoomDisplay, updateWaitingRoomDisplay,
  type HealthUnit, type WaitingRoomDisplay
} from "../../lib/api";
import { CALL_LOCATIONS_KEY, DISPLAYS_KEY, isUpa, locationNameProblem, urgencyError } from "../../lib/urgency";
import { fmtDateTime, fmtHourMinute } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, okText, row, stack } from "../exams/styles";
import type { Tone } from "../../theme/tokens";

type Pending =
  | { kind: "add"; name: string }
  | { kind: "code" | "revoke" | "waitTimes" | "active"; d: WaitingRoomDisplay };
type Shown = { displayId: string; name: string; code: string; expiresAt: string } | { displayId: string; name: string; expired: true };

const NAME_MAX = 60;

function statusOf(d: WaitingRoomDisplay): { text: string; tone?: Tone } {
  if (!d.active) return { text: "desativada" };
  if (d.revoked) return { text: "revogada", tone: "down" };
  if (d.paired) return { text: "pareada", tone: "ok" };
  return { text: "aguardando pareamento", tone: "warn" };
}
// Última leitura do board pela TV.
function seenLabel(iso: string | null, now: number): string {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(at)) return "nunca visto";
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return "visto há menos de 1 min";
  if (min < 60) return `visto há ${min} min`;
  if (min < 24 * 60) return `visto há ${Math.floor(min / 60)} h`;
  return `visto em ${fmtDateTime(iso)}`;
}
// O endereço da TV é o deste painel, na rota #/tv (fora do shell).
const tvAddress = (): string => `${window.location.origin}${window.location.pathname}#/tv`;

export function DisplaysPanel({ unit, onGoToSecurity }: { unit: HealthUnit; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const key = [ DISPLAYS_KEY, unit.id ];
  const list = useQuery({ queryKey: key, queryFn: () => listWaitingRoomDisplays(unit.id), refetchOnWindowFocus: false });
  const [ name, setName ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ shown, setShown ] = useState<Shown | null>(null);
  const upa = isUpa(unit);
  const now = Date.now();

  const replace = (item: WaitingRoomDisplay) =>
    queryClient.setQueryData<WaitingRoomDisplay[]>(key, (old) => old?.map((x) => (x.id === item.id ? item : x)));
  // Revogar ou desativar muda `location_required` da lista de locais.
  const refreshLocations = () => void queryClient.invalidateQueries({ queryKey: [ CALL_LOCATIONS_KEY, unit.id ] });
  const forget = (displayId: string) => setShown((s) => (s && s.displayId === displayId ? null : s));

  function add(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const found = locationNameProblem(name, NAME_MAX);
    setProblem(found);
    setPending(found ? null : { kind: "add", name: name.trim() });
  }
  function begin(p: Pending) {
    setNotice(null); setProblem(null);
    // Gerar outro código apaga o que está à vista antes de pedir o novo.
    if (p.kind === "code") setShown(null);
    setPending(p);
  }
  async function run(p: Pending): Promise<void> {
    if (p.kind === "add") {
      await createWaitingRoomDisplay({ health_unit_id: unit.id, name: p.name, active: true, show_wait_times: true });
      return;
    }
    const d = p.d;
    if (p.kind === "code") {
      const c = await createPairingCode(d.id);
      setShown({ displayId: d.id, name: d.name, code: c.code, expiresAt: c.expires_at });
      return;
    }
    if (p.kind === "revoke") { replace(await revokeWaitingRoomDisplay(d.id)); return; }
    const body = p.kind === "waitTimes"
      ? { name: d.name, active: d.active, show_wait_times: !d.show_wait_times }
      : { name: d.name, active: !d.active, show_wait_times: d.show_wait_times };
    replace(await updateWaitingRoomDisplay(d.id, body));
  }
  function finished(p: Pending) {
    setPending(null);
    if (p.kind === "add") {
      setName(""); setNotice("TV cadastrada. Gere o código e digite-o na TV.");
      void queryClient.invalidateQueries({ queryKey: key });
      return;
    }
    if (p.kind === "revoke") { forget(p.d.id); setNotice(`${p.d.name} revogada: a tela volta a pedir código.`); refreshLocations(); }
    else if (p.kind === "active") {
      if (p.d.active) forget(p.d.id);
      setNotice(p.d.active ? `${p.d.name} desativada.` : `${p.d.name} ativada. Gere um código para pareá-la.`);
      refreshLocations();
    } else if (p.kind === "waitTimes") setNotice(`${p.d.name} atualizada.`);
  }

  const busy = pending !== null;
  const cols: Column<WaitingRoomDisplay>[] = [
    { label: "Nome", w: "2fr", card: "title", render: (d) => d.name },
    { label: "Situação", w: "1.3fr", render: (d) => { const s = statusOf(d); return <Tag tone={s.tone}>{s.text}</Tag>; } },
    { label: "Última leitura", w: "1.3fr", render: (d) => seenLabel(d.last_seen_at, now) },
    ...(upa ? [ { label: "Tempo de espera por cor", w: "1.2fr", card: "pair" as const, render: (d: WaitingRoomDisplay) => (
      <input type="checkbox" checked={d.show_wait_times} disabled={busy || !d.active}
        aria-label={`Mostrar o tempo de espera por cor em ${d.name}`} onChange={() => begin({ kind: "waitTimes", d })} />
    ) } ] : []),
    { label: "", w: "auto", align: "right", card: "actions", render: (d) => (
      <div style={{ ...row, justifyContent: "flex-end" }}>
        {d.active && (
          <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={`Gerar código para ${d.name}`}
            onClick={() => begin({ kind: "code", d })}>Gerar código</button>
        )}
        {d.active && d.paired && !d.revoked && (
          <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={`Revogar ${d.name}`}
            onClick={() => begin({ kind: "revoke", d })}>Revogar</button>
        )}
        <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={`${d.active ? "Desativar" : "Ativar"} ${d.name}`}
          onClick={() => begin({ kind: "active", d })}>{d.active ? "Desativar" : "Ativar"}</button>
      </div>
    ) }
  ];

  return (
    <Panel title="TVs da sala de espera" sub={`${unit.name} · a TV mostra as últimas chamadas, sem nome nem queixa`}>
      <div style={stack}>
        <p style={muted}>
          {upa
            ? unit.show_wait_times === false
              ? "Os tempos estão desligados no cadastro da unidade (Atendimento → Unidades): nenhuma TV desta UPA mostra os tempos de espera, mesmo com a opção ligada na TV."
              : "Os tempos de espera por cor aparecem só na TV com “Mostrar o tempo de espera por cor” ligado e com “Mostrar tempos de espera na TV” ligado no cadastro da UPA."
            : `${unit.kind === "ubs" ? "Na UBS" : "Fora da UPA"}, a TV mostra só as chamadas, sem tempos de espera.`}
        </p>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {shown && <PairingCodeBox key={"code" in shown ? shown.code : "expired"} shown={shown} onExpired={() => setShown((s) =>
          (s && "code" in s ? { displayId: s.displayId, name: s.name, expired: true } : s))} />}
        {list.isPending && <p className="mono" style={muted}>carregando…</p>}
        {list.isError && <p role="alert" style={alert}>{urgencyError(list.error)}</p>}
        {list.data && <DataTable<WaitingRoomDisplay> cols={cols} rows={list.data} rowKey={(d) => d.id} empty="nenhuma TV cadastrada" />}
        <form onSubmit={add} style={{ ...row, alignItems: "flex-end" }}>
          <label style={{ ...fieldLabel, flex: "1 1 200px", maxWidth: 320 }}>
            Nome da TV
            <input value={name} style={inputStyle} placeholder="ex.: TV da recepção" aria-invalid={problem ? true : undefined}
              onChange={(e) => { setName(e.target.value); setProblem(null); setNotice(null); }} />
          </label>
          <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Cadastrar TV</button>
        </form>
        {problem && <p role="alert" style={alert}>{problem}</p>}
        {pending && (
          <SensitiveAction
            key={pending.kind === "add" ? `add-${pending.name}` : `${pending.kind}-${pending.d.id}`}
            title={titleOf(pending)}
            description={descriptionOf(pending)}
            requiresStepUp
            run={() => run(pending)}
            onDone={() => finished(pending)}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(e) => {
              // A TV foi desativada em outra aba: a lista é relida e o botão some.
              if (errorCode(e) === "display_inactive") void queryClient.invalidateQueries({ queryKey: key });
              return urgencyError(e);
            }}
          />
        )}
      </div>
    </Panel>
  );
}

function titleOf(p: Pending): string {
  if (p.kind === "add") return "Cadastrar TV";
  if (p.kind === "code") return `Código de pareamento · ${p.d.name}`;
  if (p.kind === "revoke") return `Revogação · ${p.d.name}`;
  if (p.kind === "waitTimes") return `Tempo de espera por cor · ${p.d.name}`;
  return `${p.d.active ? "Desativação" : "Ativação"} · ${p.d.name}`;
}
function descriptionOf(p: Pending): string {
  if (p.kind === "add") return `A TV “${p.name}” entra na lista desta unidade; depois, gere o código para pareá-la.`;
  const d = p.d;
  if (p.kind === "code") {
    return "O código vale 10 minutos e uma vez só." +
      (d.paired && !d.revoked ? " Quando ele for usado, a tela pareada agora deixa de valer." : "");
  }
  if (p.kind === "revoke") return "Revogar a TV? Ela volta a pedir código.";
  if (p.kind === "waitTimes") {
    return d.show_wait_times ? `A TV “${d.name}” deixa de mostrar o tempo de espera por cor.` : `A TV “${d.name}” passa a mostrar o tempo de espera por cor.`;
  }
  return d.active
    ? `A TV “${d.name}” sai do ar e deixa de valer; para voltar, ative e gere um código novo.`
    : `A TV “${d.name}” volta à lista; gere um código para pareá-la.`;
}

const codeStyle = { margin: 0, fontSize: 32, letterSpacing: "0.2em", fontWeight: 600 };

// O código à vista, com a validade. O relógio é limpo ao vencer e ao desmontar.
function PairingCodeBox({ shown, onExpired }: { shown: Shown; onExpired(): void }) {
  const expiresAt = "code" in shown ? Date.parse(shown.expiresAt) : Number.NaN;
  const [ now, setNow ] = useState(() => Date.now());
  const expired = !("code" in shown) || !(expiresAt > now);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;
  useEffect(() => {
    if (expired) {
      if ("code" in shown) onExpiredRef.current();
      return undefined;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(id); };
  }, [ expired, shown ]);

  if (expired) return <p role="status" style={alert}>código vencido — gere outro</p>;
  const left = Math.ceil((expiresAt - now) / 1000);
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <section aria-label={`Código de pareamento de ${shown.name}`} style={box}>
      <strong>{`Código para ${shown.name}`}</strong>
      <p className="mono" style={codeStyle}>{shown.code}</p>
      <p style={{ margin: 0, fontSize: 12.5 }}>{`Vale até ${fmtHourMinute(shown.expiresAt)}. Na TV, abra ${tvAddress()} e digite o código.`}</p>
      <p className="mono" style={muted}>{`expira em ${mmss}`}</p>
    </section>
  );
}
