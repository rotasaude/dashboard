// PharmacyEntries — entradas por nota ou doação e inventário de abertura (módulo 27a; F-27.2; contrato §4).
// Por local: o almoxarife do local registra entrada e abertura; o farmacêutico sem o papel de almoxarife naquele local vê só a
// abertura (P6 do plano do api). O api recusa de novo. A frase de sucesso fica aqui, fora do formulário que se limpa.
import { useState } from "react";
import type { PharmacyLocation, StockReceipt } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { locationRoles } from "../lib/pharmacy";
import { checkLabel, fieldset, legend, okText, row } from "./exams/styles";
import { LocationPick } from "./pharmacy/LocationPick";
import { PharmacyGate } from "./pharmacy/PharmacyGate";
import { ReceiptForm } from "./pharmacy/ReceiptForm";

type Mode = "receipt" | "opening";

const lotsText = (n: number) => `${n} ${n === 1 ? "lote" : "lotes"}`;

export function PharmacyEntries({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <PharmacyGate title="Entradas e abertura" sub="nota fiscal, doação e inventário de abertura, com lote" allow={(r) => r.keeper || r.pharmacist}>
      {() => (
        <LocationPick allow={(r) => r.keeper || r.pharmacist}>
          {(loc) => <Body location={loc} today={today} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

function Body({ location, today }: { location: PharmacyLocation; today: string }) {
  const roles = locationRoles(location);
  const [ chosen, setChosen ] = useState<Mode>("receipt");
  const [ notice, setNotice ] = useState<string | null>(null);
  // Só o almoxarife do local escolhe; o farmacêutico sem esse papel faz a abertura.
  const mode: Mode = roles.keeper ? chosen : "opening";

  function done(r: StockReceipt) {
    const n = r.items.length;
    setNotice(`${r.kind === "opening" ? "Abertura registrada" : "Entrada registrada"}: ${lotsText(n)}.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {roles.keeper && (
        <fieldset style={fieldset}>
          <legend style={legend}>O que registrar</legend>
          <div style={row}>
            <label style={checkLabel}>
              <input type="radio" name="entry-mode" checked={mode === "receipt"} onChange={() => { setNotice(null); setChosen("receipt"); }} />
              Entrada
            </label>
            <label style={checkLabel}>
              <input type="radio" name="entry-mode" checked={mode === "opening"} onChange={() => { setNotice(null); setChosen("opening"); }} />
              Inventário de abertura
            </label>
          </div>
        </fieldset>
      )}
      {notice && <p role="status" style={okText}>{notice}</p>}
      <ReceiptForm key={mode} location={location} mode={mode} today={today} onStart={() => setNotice(null)} onDone={done} />
    </div>
  );
}
