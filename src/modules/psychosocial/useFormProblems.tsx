// Molde dos formulários do CAPS (módulo 31): problemas por `path`, envio único e foco.
// - Foco no título ao abrir. Depois, foco no primeiro campo inválido (ou na frase geral), só depois de um envio recusado, na tela
//   ou pelo api. Limpar a marca de um campo enquanto se digita nunca move o foco (lição da Task 4).
// - Sem duplo envio: `sending` (ref) e `busy` (botões desabilitados). A resposta que chega depois de desmontar é ignorada
//   (`alive` volta a true no remonte do StrictMode).
// - A recusa vem toda de uma vez (`psyRefusals`). `not_found`, `referral_not_pending` e `already_closed` dizem que a tela estava velha:
//   vão a `stale`, quando quem usa o passa.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { errorCode } from "../../lib/api";
import { isStale, psyRefusals, type PsyRefusal } from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { alert } from "../exams/styles";

export type FormSend<T> = {
  // Problemas locais; a lista não vazia vai à tela e nada é enviado.
  check?(): Problem[];
  call(): Promise<T>;
  ok(result: T): void;
  stale?(text: string): void;
  // Recusa do api → problemas na tela (padrão: path e frase de cada recusa).
  refused?(refusals: PsyRefusal[]): Problem[];
};

// Todas as frases distintas do path (a crítica do api pode pôr mais de uma no mesmo campo). Uma só: um <p> com o id; mais de uma:
// o id fica no wrapper, para o `aria-describedby` do campo apontar para algo que existe.
export function fieldErrors(problems: Problem[], path: string, id: string): ReactNode {
  const texts = [ ...new Set(problems.filter((p) => p.path === path).map((p) => p.text)) ];
  if (texts.length === 0) return null;
  if (texts.length === 1) return <p id={id} role="alert" style={alert}>{texts[0]}</p>;
  return <div id={id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>{texts.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}</div>;
}

// `opts` troca o tradutor das recusas e o critério de tela velha (a ouvidoria passa os dela); sem `opts`, vale o do CAPS.
export type FormProblemsOptions = { refusals?(err: unknown): PsyRefusal[]; isStale?(err: unknown): boolean };

export function useFormProblems(opts: FormProblemsOptions = {}) {
  const translate = opts.refusals ?? psyRefusals;
  const staleOf = opts.isStale ?? ((err: unknown) => isStale(err) || errorCode(err) === "already_closed");
  const uid = useId();
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const focusNext = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    alive.current = true;
    titleRef.current?.focus();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-general='true']");
    // Um grupo de caixas inválido não recebe foco: vai à primeira caixa dele.
    (first instanceof HTMLFieldSetElement ? first.querySelector<HTMLElement>("input") : first)?.focus();
  }, [ problems ]);

  const show = (list: Problem[]) => { focusNext.current = true; setProblems(list); };
  const clear = (...paths: string[]) => setProblems((ps) => (ps.some((p) => paths.includes(p.path)) ? ps.filter((p) => !paths.includes(p.path)) : ps));
  const textOf = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const fid = (path: string) => `${uid}-${path}`;
  const aria = (path: string) => (textOf(path) ? { "aria-invalid": true as const, "aria-describedby": `${fid(path)}-err` } : {});
  const errNode = (path: string): ReactNode => fieldErrors(problems, path, `${fid(path)}-err`);
  // As frases que não são de nenhum campo do formulário, sem repetir.
  const top = (own: (path: string) => boolean): ReactNode =>
    [ ...new Set(problems.filter((p) => !own(p.path)).map((p) => p.text)) ]
      .map((t) => <p key={t} role="alert" tabIndex={-1} data-general="true" style={alert}>{t}</p>);

  async function submit<T>(ev: FormEvent, o: FormSend<T>) {
    ev.preventDefault();
    if (sending.current) return;
    const local = o.check?.() ?? [];
    if (local.length > 0) { show(local); return; }
    sending.current = true;
    setBusy(true);
    setProblems([]);
    try {
      const result = await o.call();
      if (alive.current) o.ok(result);
    } catch (err) {
      if (!alive.current) return;
      const refusals = translate(err);
      if (o.stale && staleOf(err)) { o.stale(refusals[0].text); return; }
      show(o.refused ? o.refused(refusals) : refusals.map((r) => ({ path: r.path, text: r.text })));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return { problems, setProblems, busy, formRef, titleRef, show, clear, textOf, fid, aria, errNode, top, submit };
}
