// src/modules/vectorControl/CollectForm.tsx
// Coleta da palheta pelo agente de endemias (módulo 35a, F-35.5; contrato §6; Q7(5), Q9). POST /vector_control/ovitraps/:id/collect
// com `{ collected_on, condition, reinstall, remove }`: a tela manda os dois, `reinstall: !remove` (com `remove` o api ignora o
// reinstall). A janela da palheta (`collectionProblems`, dias corridos entre a instalação da leitura aberta e a coleta, nos
// parâmetros dos domínios) recusa antes de enviar; sem os parâmetros (domínios falharam), quem decide é o api.
// A coleta não tem client_uuid: tela velha (404, ovitrampa já inativa, leitura já fechada) ou rede/5xx (não se sabe se gravou)
// fecham o formulário e o pai relê a lista UMA vez, sem reenviar.
import { useState, type FormEvent } from "react";
import { collectOvitrap, errorCode, type Ovitrap, type ReadingCondition, type VectorControlDomains } from "../../lib/api";
import { fmtDay, isNetworkOrServer } from "../../lib/homeVisits";
import { collectionProblems, conditionLabel, isVectorStale, vectorRefusals } from "../../lib/vectorControl";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { useWriteLock } from "../homeVisits/writeLock";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export const LOST_ON_REMOVE = "a ovitrampa sai como perdida";
export const COLLECT_STALE_REREAD = "a lista foi relida";
export const COLLECT_UNCERTAIN = "não foi possível confirmar a coleta — a lista foi relida; confira a ovitrampa antes de coletar de novo";

const CONDITIONS: ReadingCondition[] = [ "ok", "damaged", "lost", "dry" ];
// A leitura já não está como a tela mostrou (collect_ovitrap.rb: ovitrap_not_active, reading_not_open; o 404 da ovitrampa).
const GONE = [ "ovitrap_not_active", "reading_not_open" ];
const OWN = [ "collected_on", "condition", "reinstall", "remove" ];

export type CollectParams = Pick<VectorControlDomains["parameters"], "ovitrap_collection_days_min" | "ovitrap_collection_days_max">;

export function CollectForm({ ovitrap, params, today, onDone, onStale, onCancel }: {
  ovitrap: Ovitrap; params: CollectParams | null; today: string;
  onDone(o: Ovitrap): void; onStale(text: string): void; onCancel(): void;
}) {
  const lock = useWriteLock();
  const f = useFormProblems({
    refusals: (err) => vectorRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isVectorStale(err) || GONE.includes(errorCode(err) ?? "") || isNetworkOrServer(err)
  });
  const [ collectedOn, setCollectedOn ] = useState(today);
  const [ condition, setCondition ] = useState<ReadingCondition | null>(null);
  const [ reinstall, setReinstall ] = useState(true);
  const [ remove, setRemove ] = useState(false);
  const installedOn = ovitrap.open_reading?.installed_on ?? "";
  // Sem parâmetros, a janela não é conferida aqui (o api confere).
  const range = params ?? { ovitrap_collection_days_min: -Infinity, ovitrap_collection_days_max: Infinity };

  function submit(ev: FormEvent) {
    if (lock.held()) { ev.preventDefault(); return; }
    void f.submit(ev, {
      check: () => collectionProblems({ installedOn, collectedOn, condition }, range, today),
      call: () => lock.run(() => collectOvitrap(ovitrap.id, { collected_on: collectedOn, condition: condition!, reinstall: !remove && reinstall, remove })),
      ok: onDone,
      stale: (text, err) => onStale(isNetworkOrServer(err) ? COLLECT_UNCERTAIN : `${text} — ${COLLECT_STALE_REREAD}`)
    });
  }

  const busy = f.busy || lock.busy;
  return (
    <form ref={f.formRef} noValidate style={form} aria-label={`Coletar palheta da ovitrampa ${ovitrap.number}`} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>{`Coletar palheta — ovitrampa ${ovitrap.number}`}</p>
      <span style={muted}>{`${ovitrap.household.address_short} · palheta desde ${fmtDay(installedOn)}`}</span>

      <label style={fieldLabel}>
        Data da coleta
        <input type="date" value={collectedOn} max={today} disabled={busy} style={inputStyle} {...f.aria("collected_on")}
          onChange={(e) => { setCollectedOn(e.target.value); f.clear("collected_on"); }} />
      </label>
      {f.errNode("collected_on")}

      <fieldset style={fieldset} {...f.aria("condition")}>
        <legend style={legend}>Condição da palheta</legend>
        <div style={row}>
          {CONDITIONS.map((c) => (
            <label key={c} style={checkLabel}>
              <input type="radio" name={`condition-${ovitrap.id}`} checked={condition === c} disabled={busy}
                onChange={() => { setCondition(c); f.clear("condition"); }} />
              {conditionLabel(c)}
            </label>
          ))}
        </div>
      </fieldset>
      {f.errNode("condition")}

      <label style={checkLabel}>
        <input type="checkbox" checked={!remove && reinstall} disabled={busy || remove} onChange={(e) => setReinstall(e.target.checked)} />
        Reinstalar palheta
      </label>
      <label style={checkLabel}>
        <input type="checkbox" checked={remove} disabled={busy} onChange={(e) => setRemove(e.target.checked)} />
        Retirar a ovitrampa
      </label>
      {remove && condition === "lost" && <p role="status" style={muted}>{LOST_ON_REMOVE}</p>}

      {f.top((p) => OWN.includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Registrar coleta</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
