// PharmacyAdjustments — inventário, perdas, vencimentos e a aprovação de ajustes (módulo 27a; F-27.4; contrato §6).
// Por local: o farmacêutico e o almoxarife ajustam, registram perda e vencimento e decidem os ajustes pendentes DE OUTRA PESSOA.
// As frases de sucesso e de "já decidido" ficam aqui, fora dos formulários que se fecham. Sem polling (dado sem pessoa: lê ao abrir
// e depois de cada escrita). O api recusa de novo o que a tela não oferece.
import { useState } from "react";
import { todayInCity } from "../lib/campaigns";
import type { PharmacyLocation } from "../lib/api";
import { okText, alert, muted, stack } from "./exams/styles";
import { AdjustmentForm, adjustmentSavedText } from "./pharmacy/AdjustmentForm";
import { LocationPick } from "./pharmacy/LocationPick";
import { PendingAdjustments } from "./pharmacy/PendingAdjustments";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export function PharmacyAdjustments({ today = todayInCity(), onGoToSecurity }: { today?: string; onGoToSecurity?(): void } = {}) {
  return (
    <PharmacyGate title="Inventário e ajustes" sub="ajustes, perdas e vencimentos, com aprovação" allow={(r) => r.pharmacist || r.keeper}>
      {() => (
        <LocationPick allow={(r) => r.pharmacist || r.keeper}>
          {(loc) => <Body location={loc} today={today} onGoToSecurity={onGoToSecurity} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

function Body({ location, today, onGoToSecurity }: { location: PharmacyLocation; today: string; onGoToSecurity?(): void }) {
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ stale, setStale ] = useState<string | null>(null);
  const clear = () => { setNotice(null); setStale(null); };
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {stale && <p role="alert" style={alert}>{stale}</p>}
      <AdjustmentForm location={location} today={today} onStart={clear} onGoToSecurity={onGoToSecurity}
        onDone={(saved, kind) => { setStale(null); setNotice(adjustmentSavedText(kind, saved.status)); }} />
      <PendingAdjustments location={location} onGoToSecurity={onGoToSecurity}
        onNotice={(text) => { setStale(null); setNotice(text); }} onStale={(text) => { setNotice(null); setStale(text); }} />
    </div>
  );
}
