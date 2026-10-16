// Digitação pela leitura (spec §5.6): lê a etiqueta, escolhe o exame da
// amostra e digita. Uma etiqueta serve a vários exames (B5/B16/B39), então a
// leitura só lista os exames da amostra; abrir o exame é que chama /lab/entry
// (com o código SIGTAP). Sem polling nem releitura ao voltar
// a rede; nada de etiqueta ou valor em log, console ou storage.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getLabEntry, listLabEntryItems, type LabEntryItem, type LabEntryListItem } from "../lib/api";
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
  const [ exams, setExams ] = useState<LabEntryListItem[]>([]);
  const [ entry, setEntry ] = useState<LabEntryItem | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ opening, setOpening ] = useState(false);
  // a leitura/abertura mais recente vence; resposta atrasada é descartada
  const seq = useRef(0);

  async function scan(code: string): Promise<ScanOutcome> {
    const mine = ++seq.current;
    try {
      const found = await listLabEntryItems(code);
      if (mine !== seq.current) return { ok: true, text: "substituída por uma leitura mais nova" };
      setBarcode(code);
      setExams(found);
      setEntry(null);
      setError(null);
      if (found.length === 0) return { ok: false, text: "nenhum exame para digitar nesta amostra" };
      return { ok: true, text: found.length === 1 ? "1 exame nesta amostra" : `${found.length} exames nesta amostra` };
    } catch (err) {
      return { ok: false, text: labError(err) };
    }
  }

  // Sempre mostra os botões, mesmo com um exame só: abrir é que grava a trilha
  // de acesso aos dados do paciente, e isso deve ser uma escolha de quem digita.
  async function open(item: LabEntryListItem) {
    if (opening) return;
    const mine = ++seq.current;
    setOpening(true);
    setError(null);
    try {
      const [ found ] = await getLabEntry({ barcode, sigtapCode: item.sigtap_code });
      if (mine !== seq.current) return;
      if (found) setEntry(found);
      else setError("nenhum exame para digitar nesta amostra");
    } catch (err) {
      if (mine === seq.current) setError(labError(err));
    } finally {
      setOpening(false);
    }
  }

  async function reload(itemId: string, saved: boolean) {
    try {
      const [ fresh ] = await getLabEntry({ itemId });
      setEntry((cur) => (cur && cur.item_id === itemId ? fresh ?? null : cur));
    } catch (err) {
      setError(saved ? `resultado salvo, mas não foi possível reler o exame — ${labError(err)}` : `não foi possível reler o exame — ${labError(err)}`);
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
            <button key={i.item_id} type="button" style={secondaryButtonStyle} aria-pressed={entry?.item_id === i.item_id}
              aria-disabled={opening || undefined} title={itemStatusLabel(i.status)} onClick={() => void open(i)}>{i.name}</button>
          ))}
        </div>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      {entry && (
        <ResultEntryForm key={entry.item_id} item={entry} onClose={() => setEntry(null)}
          onSaved={() => void reload(entry.item_id, true)} onStale={() => void reload(entry.item_id, false)} />
      )}
    </div>
  );
}
