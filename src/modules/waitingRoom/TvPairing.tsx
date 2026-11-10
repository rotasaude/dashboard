// Pareamento da TV (WaitingRoom::Pair): o código de 6 dígitos vai como texto (o zero da frente conta), sem cookie e sem CSRF; a
// resposta traz só o token, que sobe para quem guarda. Um pedido por vez (`busy` + ref). Recusa vira a frase do urgencyError
// (invalid_pairing_code, too_many_requests, feature_disabled), sem eco do código.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { pairWaitingRoomDisplay } from "../../lib/api";
import { pairingCodeProblem, urgencyError } from "../../lib/urgency";
import "./tv.css";

export const PAIRING_HINT = "Peça o código à administração da unidade (Urgência → Senhas, locais e TVs).";

export function TvPairing({ onPaired }: { onPaired(token: string): void }) {
  const [ code, setCode ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const inputId = useId();
  const problemId = useId();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    const value = code.trim();
    const invalid = pairingCodeProblem(value);
    if (invalid) { setProblem(invalid); return; }
    sending.current = true;
    setBusy(true);
    setProblem(null);
    pairWaitingRoomDisplay(value)
      .then(
        (r) => { if (alive.current) onPaired(r.display_token); },
        (err: unknown) => { if (alive.current) setProblem(urgencyError(err)); }
      )
      .finally(() => {
        sending.current = false;
        if (alive.current) setBusy(false);
      });
  };

  return (
    <main className="tv tv-pairing" aria-label="Painel de chamada">
      <form className="tv-pairing-form" onSubmit={submit} noValidate>
        <h1 className="tv-pairing-title">Painel da sala de espera</h1>
        <label className="tv-pairing-label" htmlFor={inputId}>Código de pareamento</label>
        <input
          id={inputId} className="tv-pairing-input" value={code} onChange={(e) => setCode(e.target.value)}
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-invalid={problem !== null}
          aria-describedby={problem ? problemId : undefined}
        />
        {problem && <p id={problemId} className="tv-pairing-problem" role="alert">{problem}</p>}
        <button type="submit" className="tv-button" disabled={busy}>Parear esta TV</button>
        <p className="tv-pairing-hint">{PAIRING_HINT}</p>
      </form>
    </main>
  );
}
