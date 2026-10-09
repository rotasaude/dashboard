// src/lib/useAutosave.ts
// Salvamento automático do rascunho da consulta (módulo 19; spec §4). Regras:
// - um salvamento por vez; se o valor mudou enquanto salvava, salva de novo
//   com o mais novo (nunca manda um valor velho por último);
// - a resposta do servidor nunca volta para o formulário (o que a pessoa
//   digitou durante o salvamento fica);
// - `flush()` espera o que estiver em curso e salva o que faltar — a
//   finalização chama antes de fechar a consulta;
// - `blockedReason` (texto longo demais) e `enabled: false` (consulta travada)
//   impedem salvar; ao desmontar, salva o pendente.
// O valor não é guardado em nenhum outro lugar (nem localStorage).
import { useCallback, useEffect, useRef, useState } from "react";
import { fmtHourMinute } from "./format";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string };

export interface AutosaveOptions<T> {
  value: T;
  initialKey: string;
  blockedReason: string | null;
  enabled: boolean;
  delayMs: number;
  save(value: T): Promise<unknown>;
  describe(err: unknown): string;
  onError?(err: unknown): void;
  now?(): Date;
}

export function useAutosave<T>(options: AutosaveOptions<T>): { status: SaveStatus; flush(): Promise<boolean> } {
  const key = JSON.stringify(options.value);
  const latest = useRef({ key, value: options.value });
  latest.current = { key, value: options.value };
  const opts = useRef(options);
  opts.current = options;
  const savedKey = useRef(options.initialKey);
  const running = useRef<Promise<boolean> | null>(null);
  const [ status, setStatus ] = useState<SaveStatus>({ kind: "idle" });

  const pump = useCallback((): Promise<boolean> => {
    if (running.current) return running.current;
    const run = (async () => {
      // Cede a vez antes de olhar o valor: `running.current` já aponta para
      // esta execução quando o corpo roda (senão um retorno imediato limparia
      // a referência antes de ela ser gravada).
      await null;
      try {
        for (;;) {
          const { enabled, blockedReason, save, describe, onError, now } = opts.current;
          if (!enabled || blockedReason) return false;
          const { key: k, value: v } = latest.current;
          if (k === savedKey.current) return true;
          setStatus({ kind: "saving" });
          try {
            await save(v);
          } catch (err) {
            setStatus({ kind: "error", message: describe(err) });
            onError?.(err);
            // Se digitaram mais durante o salvamento que falhou, o valor novo
            // ainda precisa de uma tentativa (o temporizador dele já disparou
            // e encontrou este salvamento em curso).
            if (latest.current.key !== k) continue;
            return false;
          }
          savedKey.current = k;
          setStatus({ kind: "saved", at: now ? now() : new Date() });
        }
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!options.enabled || options.blockedReason || key === savedKey.current) return;
    const id = setTimeout(() => { void pump(); }, options.delayMs);
    return () => clearTimeout(id);
  }, [ key, options.enabled, options.blockedReason, options.delayMs, pump ]);

  // Fechar a tela (ou trocar de atendimento) não perde o que ficou pendente.
  useEffect(() => () => { void pump(); }, [ pump ]);

  return { status, flush: pump };
}

export function saveStatusLabel(status: SaveStatus, blockedReason: string | null): string {
  if (blockedReason) return `não salvo — ${blockedReason}`;
  if (status.kind === "saving") return "salvando…";
  if (status.kind === "saved") return `salvo às ${fmtHourMinute(status.at.toISOString())}`;
  if (status.kind === "error") return `não salvo — ${status.message}`;
  return "rascunho";
}
