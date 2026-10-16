// Digitação pela leitura (spec §5.6): lê a etiqueta, escolhe o exame da
// amostra e digita. Uma etiqueta serve a vários exames (B5/B16), então a
// leitura só lista os exames da amostra; abrir o exame é que chama /lab/entry
// (com o código SIGTAP) e grava a trilha. Sem polling nem releitura ao voltar
// a rede; nada de etiqueta ou valor em log, console ou storage.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getLabEntry, getLabRequisition, listLabRequisitions, type LabEntryItem, type LabItem } from "../lib/api";
import { itemStatusLabel, labError, refreshLab } from "../lib/lab";
import { Panel } from "../components/Panel";
import { secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabScope } from "./lab/LabScope";
import { ResultEntryForm } from "./lab/ResultEntryForm";
import { ScanField, type ScanOutcome } from "./lab/ScanField";
import { alert, row, stack } from "./exams/styles";

export function LabEntry() {
  return (
    <LabGate title="Digitação de resultados" sub="laboratório municipal · pela etiqueta (pelo mapa: Mapa de trabalho)" allow={(r) => r.staff}>
      {(roles) => <LabScope roles={roles}>{() => <EntryBody />}</LabScope>}
    </LabGate>
  );
}

function EntryBody() {
  const queryClient = useQueryClient();
  const [ barcode, setBarcode ] = useState("");
  const [ exams, setExams ] = useState<LabItem[]>([]);
  const [ entry, setEntry ] = useState<LabEntryItem | null>(null);
  const [ error, setError ] = useState<string | null>(null);

  async function scan(code: string): Promise<ScanOutcome> {
    try {
      const page = await listLabRequisitions({ barcode: code });
      const found = page.requisitions[0];
      if (!found) return { ok: false, text: "etiqueta não encontrada" };
      const req = await getLabRequisition(found.id);
      const sample = req.samples.find((s) => s.barcode === code);
      if (!sample) return { ok: false, text: "etiqueta não encontrada" };
      const mine = req.items.filter((i) => i.sample_id === sample.id);
      setBarcode(code);
      setExams(mine);
      setEntry(null);
      setError(null);
      if (mine.length === 0) return { ok: false, text: "nenhum exame para digitar nesta amostra" };
      return { ok: true, text: mine.length === 1 ? "1 exame nesta amostra" : `${mine.length} exames nesta amostra` };
    } catch (err) {
      return { ok: false, text: labError(err) };
    }
  }

  async function open(item: LabItem) {
    setError(null);
    try {
      const [ found ] = await getLabEntry({ barcode, sigtapCode: item.sigtap_code });
      if (found) setEntry(found);
      else setError("nenhum exame para digitar nesta amostra");
    } catch (err) {
      setError(labError(err));
    }
  }

  async function reload(itemId: string) {
    // o resultado já foi gravado: falha ao reler não o desfaz
    try {
      const [ fresh ] = await getLabEntry({ itemId });
      setEntry((cur) => (cur && cur.item_id === itemId ? fresh ?? null : cur));
    } catch (err) {
      setError(`resultado salvo, mas não foi possível reler o exame — ${labError(err)}`);
    }
    void Promise.resolve().then(() => refreshLab(queryClient)).catch(() => undefined);
  }

  return (
    <div style={stack}>
      <Panel title="Ler a etiqueta" sub="cada leitura lista os exames daquela amostra">
        <ScanField label="Etiqueta do tubo" onScan={scan} />
      </Panel>
      {exams.length > 0 && (
        <div style={row}>
          {exams.map((i) => (
            <button key={i.id} type="button" style={secondaryButtonStyle} aria-pressed={entry?.item_id === i.id}
              title={itemStatusLabel(i.status)} onClick={() => void open(i)}>{i.label}</button>
          ))}
        </div>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      {entry && <ResultEntryForm key={entry.item_id} item={entry} onSaved={() => void reload(entry.item_id)} onClose={() => setEntry(null)} />}
    </div>
  );
}
