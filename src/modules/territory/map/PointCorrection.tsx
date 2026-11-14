// Módulo 24c (ADR 0053; contrato §6, Q13, Q15): corrigir o ponto de um
// domicílio no mapa. Só corrige ponto que já existe — o primeiro ponto nasce
// no app de campo — e só quem cadastra na microárea (`can_register`).
//
// Não há PATCH parcial (Q13): a gravação relê o domicílio e manda o corpo
// inteiro do 24a com o ponto novo e a versão que a lista de pontos mostrou. Se
// alguém salvou no meio do caminho, nada é gravado e os pontos são relidos.
// A coordenada não aparece na tela nem em mensagem: quem mostra é o mapa.
import { useRef, useState } from "react";
import { getHousehold, updateHousehold, type MapHousehold } from "../../../lib/api";
import { STALE_TEXT, isStale, territoryError } from "../../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../../components/formStyles";
import { alert, muted, okText, row } from "../../exams/styles";
import { householdAsInput } from "../HouseholdForm";
import type { LatLng } from "./fieldMap";

export const POINT_SAVED = "ponto salvo";
export const CORRECTION_HINT = "Toque no mapa ou arraste o marcador";

export function PointCorrection({ item, describedBy, active, moved, locked, onStart, onStop, onDone, onStale }: {
  item: MapHousehold;
  // id do elemento com o endereço: o botão se chama "Corrigir o ponto" em todo cartão.
  describedBy: string;
  // Esta é a correção em curso; `moved` é para onde o marcador foi (null = ainda não saiu do lugar).
  active: boolean; moved: LatLng | null;
  // Outro cartão está em correção: um ponto por vez.
  locked: boolean;
  onStart(): void; onStop(): void;
  // As duas relêem os pontos da microárea.
  onDone(): void; onStale(): void;
}) {
  const [ saving, setSaving ] = useState(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ saved, setSaved ] = useState(false);
  const busy = useRef(false);

  async function save() {
    if (!moved || busy.current) return;
    busy.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const household = await getHousehold(item.id);
      if (household.version !== item.version) {
        setProblem(STALE_TEXT);
        onStop();
        onStale();
        return;
      }
      await updateHousehold(item.id,
        { ...householdAsInput(household), location: { latitude: moved.latitude, longitude: moved.longitude, source: "map" } }, item.version);
      setSaved(true);
      onStop();
      onDone();
    } catch (err) {
      if (isStale(err)) {
        setProblem(STALE_TEXT);
        onStop();
        onStale();
      } else {
        setProblem(territoryError(err)); // o marcador fica: dá para mover e tentar de novo
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  if (!active) {
    return (
      <div style={row}>
        <button type="button" style={locked ? disabledButtonStyle : secondaryButtonStyle} disabled={locked} aria-describedby={describedBy}
          onClick={() => { setProblem(null); setSaved(false); onStart(); }}>
          Corrigir o ponto
        </button>
        {saved && <p role="status" style={okText}>{POINT_SAVED}</p>}
        {problem && <p role="alert" style={alert}>{problem}</p>}
      </div>
    );
  }
  const blocked = !moved || saving;
  return (
    <div role="group" aria-label="Corrigir o ponto" aria-describedby={describedBy} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={muted}>{CORRECTION_HINT}</p>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="button" style={blocked ? disabledButtonStyle : buttonStyle} disabled={blocked} onClick={() => void save()}>Salvar ponto</button>
        <button type="button" style={secondaryButtonStyle} disabled={saving} onClick={onStop}>Cancelar</button>
      </div>
    </div>
  );
}
