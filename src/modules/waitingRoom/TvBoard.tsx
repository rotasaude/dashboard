// O quadro da TV (WaitingRoom::Board): relido a cada 5 s pelo usePolling (um pedido por vez, timer limpo ao desmontar). A URL é
// exatamente /waiting_room/board (o api recusa qualquer chave de query). Montado CAMPO A CAMPO: `unit.name`; de cada chamada só
// `ticket`, `location`, `kind` e `called_at`; dos tempos só `color` e `median_minutes` — o que mais vier no JSON nunca chega à tela.
// Falhas (preflight C Task 12, E7): 401 display_revoked/invalid_token → onRevoked (a TV pareia de novo e este quadro desmonta);
// 403 feature_disabled → a frase do painel desligado, e segue tentando; 429 → recua um minuto; rede, 5xx, 429 e o resto → mantém o
// último quadro com "sem conexão — tentando de novo".
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchWaitingRoomBoard, type BoardCall, type BoardWaitTime, type CallKind, type WaitingRoomBoard } from "../../lib/api";
import { featureDisabledKey } from "../../lib/features";
import { fmtHourMinute } from "../../lib/format";
import { PRIORITY_PHRASE, URGENCY_COLOR_LABEL, URGENCY_COLOR_TONE, WAITING_ROOM_DISABLED, WAITING_ROOM_POLL_MS } from "../../lib/urgency";
import { usePolling } from "../../lib/usePolling";
import { toneColor, toneShape } from "../../theme/tokens";
import "./tv.css";

export const TV_TITLE = "Painel de chamada";
export const TV_OFFLINE = "sem conexão — tentando de novo";
export const TV_NO_CALLS = "Aguarde ser chamado pela sua senha.";
export const TV_SMALL_WAIT = "poucas pessoas aguardando";
// 30 pedidos/min por token: depois de um 429, a TV espera um minuto inteiro antes do próximo pedido de verdade.
export const TV_RATE_LIMIT_BACKOFF_MS = 60_000;
const PREVIOUS_MAX = 7;

const KIND_LABEL: Record<CallKind, string> = { classification: "Classificação de risco", care: "Atendimento" };

interface Props { token: string; onRevoked(): void; now?: () => Date }

export function TvBoard({ token, onRevoked, now = () => new Date() }: Props) {
  const pauseUntil = useRef(0);
  const limited = useRef<unknown>(null);
  const onRevokedRef = useRef(onRevoked);
  onRevokedRef.current = onRevoked;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // A revogação sobe direto da resposta (como um evento), sem esperar um efeito: o quadro desmonta e o polling para com ele.
  // Resposta que chega depois de desmontar não apaga nada (o token guardado já pode ser outro).
  const fetcher = () => {
    if (Date.now() < pauseUntil.current) return Promise.reject(limited.current);
    return fetchWaitingRoomBoard(token).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401 && mounted.current) onRevokedRef.current();
      if (err instanceof ApiError && err.status === 429) {
        pauseUntil.current = Date.now() + TV_RATE_LIMIT_BACKOFF_MS;
        limited.current = err;
      }
      throw err;
    });
  };
  const { data, error } = usePolling<WaitingRoomBoard>(fetcher, WAITING_ROOM_POLL_MS, token);

  const revoked = error instanceof ApiError && error.status === 401;
  const disabled = featureDisabledKey(error) !== null;
  const offline = error !== null && error !== undefined && !revoked && !disabled;

  const fullscreen = useFullscreen();

  return (
    <main className="tv" aria-label="Painel de chamada">
      <header className="tv-head">
        <h1 className="tv-unit">{data && !disabled ? data.unit.name : TV_TITLE}</h1>
        <p className="tv-clock">{fmtHourMinute(now().toISOString())}</p>
        {fullscreen.supported && !fullscreen.active && (
          <button type="button" className="tv-button" onClick={fullscreen.enter}>Tela cheia</button>
        )}
      </header>
      {offline && <p className="tv-notice" role="status">{TV_OFFLINE}</p>}
      {disabled
        ? <p className="tv-message">{WAITING_ROOM_DISABLED}</p>
        : data
          ? <Board board={data} />
          : !offline && <p className="tv-message">Conectando ao painel…</p>}
    </main>
  );
}

function Board({ board }: { board: WaitingRoomBoard }) {
  const [ current, ...rest ] = board.calls;
  const previous = rest.slice(0, PREVIOUS_MAX);
  return (
    <>
      <div className="tv-grid">
        <section className="tv-current" aria-label="Chamada agora" aria-live="polite" aria-atomic="true">
          {current ? <CurrentCall call={current} /> : <p className="tv-empty">{TV_NO_CALLS}</p>}
        </section>
        <div className="tv-side">
          {previous.length > 0 && (
            <section className="tv-panel" aria-label="Chamadas anteriores">
              <h2 className="tv-panel-title">Chamadas anteriores</h2>
              <ul className="tv-list">
                {previous.map((c, i) => <PreviousCall key={`${c.ticket}|${c.called_at}|${i}`} call={c} />)}
              </ul>
            </section>
          )}
          {board.wait_times && (
            <section className="tv-panel" aria-label="Tempo de espera agora">
              <h2 className="tv-panel-title">Tempo de espera agora</h2>
              <ul className="tv-list">
                {board.wait_times.map((w) => <WaitTime key={w.color} wait={w} />)}
              </ul>
              <p className="tv-priority">{PRIORITY_PHRASE}</p>
            </section>
          )}
        </div>
      </div>
      <footer className="tv-foot">{`atualizado às ${fmtHourMinute(board.updated_at)}`}</footer>
    </>
  );
}

function CurrentCall({ call }: { call: BoardCall }) {
  return (
    <>
      <p className="tv-current-kind">{KIND_LABEL[call.kind]}</p>
      <p className="tv-current-ticket"><span className="tv-current-prefix">Senha</span> <span>{call.ticket}</span></p>
      {call.location && <p className="tv-current-location">{call.location}</p>}
      <p className="tv-current-time">{`chamada às ${fmtHourMinute(call.called_at)}`}</p>
    </>
  );
}

function PreviousCall({ call }: { call: BoardCall }) {
  return (
    <li className="tv-row">
      <span className="tv-prev-ticket">{call.ticket}</span>
      {call.location && <span className="tv-prev-location">{call.location}</span>}
      <span className="tv-prev-meta">{KIND_LABEL[call.kind]}</span>
      <span className="tv-prev-meta">{fmtHourMinute(call.called_at)}</span>
    </li>
  );
}

// A cor por texto e por forma, nunca só pela tinta (WCAG 1.4.1); laranja não tem tom no tema: o tom de urgente com "laranja".
function WaitTime({ wait }: { wait: BoardWaitTime }) {
  const tone = URGENCY_COLOR_TONE[wait.color];
  const { fg, bg } = toneColor(tone);
  return (
    <li className="tv-row">
      <span className="tv-chip" data-glyph={toneShape(tone) ?? undefined} style={{ color: fg, background: bg }}>
        {URGENCY_COLOR_LABEL[wait.color]}
      </span>
      <span className="tv-wait">
        {wait.median_minutes === "lt5_patients" ? TV_SMALL_WAIT : `cerca de ${wait.median_minutes} min`}
      </span>
    </li>
  );
}

// Tela cheia pelo botão ou pela tecla F; o botão some depois de entrar e não aparece onde o navegador não oferece.
function useFullscreen() {
  const supported = typeof document.documentElement.requestFullscreen === "function";
  const [ active, setActive ] = useState(() => Boolean(document.fullscreenElement));
  const enter = useCallback(() => {
    if (document.fullscreenElement) return;
    try {
      void Promise.resolve(document.documentElement.requestFullscreen?.()).catch(() => { /* recusado pelo navegador */ });
    } catch { /* sem suporte */ }
  }, []);
  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement));
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) enter();
    };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("keydown", onKey);
    };
  }, [ enter ]);
  return { supported, active, enter };
}
