// Campo de leitura do código de barras (spec §5.2–§5.4). O leitor é um
// teclado: digita o código e manda Enter. As leituras entram numa fila e são
// gravadas uma por vez, na ordem (o leitor é mais rápido que a rede); o mesmo
// código repetido em até 2 s é a mesma etiqueta lida duas vezes e é ignorado.
// O campo nasce com foco, mas nunca o rouba de volta: sem foco, avisa.
// Nada aqui vai para log, console ou storage: o código lido só aparece na tela.
import { useEffect, useId, useRef, useState } from "react";
import { BARCODE_INVALID, normalizeBarcode } from "../../lib/lab";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { Tag } from "../../components/Tag";
import { box, fieldLabel, list, muted, row } from "../exams/styles";

export interface ScanOutcome { ok: boolean; text: string }
export const SCAN_DUPLICATE_MS = 2000;
export const SCAN_LOG_SIZE = 8;
export const SCAN_FOCUS_HINT = "clique no campo para ler";
export const SCAN_DUPLICATE = "lida duas vezes seguidas — a segunda foi ignorada";
const SCAN_FAILED = "não foi possível registrar — leia de novo";

interface Entry { id: number; code: string; state: "waiting" | "ok" | "error" | "ignored"; text: string }
interface Job<C> { id: number; code: string; captured: C | undefined }

export function ScanField<C = undefined>({ label, onScan, hint, onBusyChange, capture, onQueued }: {
  label: string; onScan(code: string, captured: C | undefined): Promise<ScanOutcome>; hint?: string;
  // `capture` roda quando a leitura ENTRA na fila (a escolha da tela naquele instante) e vai a `onScan`;
  // `onQueued` roda logo depois, com a leitura aceita na fila (ex.: a tela volta à escolha padrão).
  capture?(): C; onQueued?(): void;
  // true enquanto houver leitura na fila ou em gravação (quem conclui algo irreversível espera)
  onBusyChange?(busy: boolean): void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [ value, setValue ] = useState("");
  const [ focused, setFocused ] = useState(true);
  const [ log, setLog ] = useState<Entry[]>([]);
  const queue = useRef<Job<C>[]>([]);
  const running = useRef(false);
  const mounted = useRef(true);
  const seq = useRef(0);
  const last = useRef<{ code: string; at: number } | null>(null);
  // A função da hora da leitura mais recente do pai (ex.: decisão escolhida antes).
  const scanRef = useRef(onScan);
  scanRef.current = onScan;
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const queuedRef = useRef(onQueued);
  queuedRef.current = onQueued;
  const busyRef = useRef(onBusyChange);
  busyRef.current = onBusyChange;

  useEffect(() => {
    mounted.current = true;
    inputRef.current?.focus();
    return () => { mounted.current = false; queue.current = []; };
  }, []);

  const push = (entry: Entry) => setLog((l) => [ entry, ...l ].slice(0, SCAN_LOG_SIZE));
  const settle = (id: number, state: Entry["state"], text: string) => {
    if (mounted.current) setLog((l) => l.map((e) => (e.id === id ? { ...e, state, text } : e)));
  };

  // Leitura que falhou não vale como "já lida": o operador pode repetir já.
  const forgetLast = (code: string) => { if (last.current?.code === code) last.current = null; };

  async function drain() {
    if (running.current) return;
    running.current = true;
    try {
      while (mounted.current && queue.current.length > 0) {
        const job = queue.current.shift() as Job<C>;
        try {
          const out = await scanRef.current(job.code, job.captured);
          if (!out.ok) forgetLast(job.code);
          settle(job.id, out.ok ? "ok" : "error", out.text);
        } catch {
          forgetLast(job.code);
          settle(job.id, "error", SCAN_FAILED);
        }
      }
    } finally {
      running.current = false;
      if (queue.current.length === 0 && mounted.current) busyRef.current?.(false);
    }
  }

  function submit() {
    const raw = value;
    setValue("");
    const id = ++seq.current;
    const code = normalizeBarcode(raw);
    if (code === null) { push({ id, code: raw.trim() || "—", state: "error", text: BARCODE_INVALID }); return; }
    const now = Date.now();
    if (last.current && last.current.code === code && now - last.current.at < SCAN_DUPLICATE_MS) {
      push({ id, code, state: "ignored", text: SCAN_DUPLICATE });
      return;
    }
    last.current = { code, at: now };
    push({ id, code, state: "waiting", text: "aguardando…" });
    queue.current.push({ id, code, captured: captureRef.current?.() });
    busyRef.current?.(true);
    queuedRef.current?.();
    void drain();
  }

  return (
    <div style={box}>
      <label htmlFor={inputId} style={fieldLabel}>{label}</label>
      <input
        id={inputId} ref={inputRef} value={value} autoComplete="off" spellCheck={false} inputMode="text" style={inputStyle}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      />
      {hint && <p style={muted}>{hint}</p>}
      {!focused && (
        <div style={row}>
          <p role="status" style={muted}>{SCAN_FOCUS_HINT}</p>
          <button type="button" style={secondaryButtonStyle} onClick={() => inputRef.current?.focus()}>Voltar a ler</button>
        </div>
      )}
      {log.length > 0 && (
        <ol aria-label="leituras" aria-live="polite" style={list}>
          {log.map((e) => (
            <li key={e.id}>
              {e.state === "error" && <Tag tone="down">erro</Tag>}
              {e.state === "ignored" && <Tag tone="neutral">repetida</Tag>}
              {e.state === "ok" && <Tag tone="ok">ok</Tag>}{" "}
              <span className="mono">{`${e.code} · ${e.text}`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
