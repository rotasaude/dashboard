// src/modules/LabCollection.tsx
// Coleta (spec §5.2): ler a etiqueta registra quem coletou e quando; no 21a o
// exame vai a `collected`. A UBS que coleta e o posto do laboratório usam a
// mesma tela; o api confere a unidade e a situação da amostra.
// O código lido só aparece na tela (nunca em log, console ou storage).
import { useQueryClient } from "@tanstack/react-query";
import { collectSampleByBarcode, errorCode } from "../lib/api";
import { labError, refreshLab } from "../lib/lab";
import { Panel } from "../components/Panel";
import { LabGate } from "./lab/LabGate";
import { LabScope } from "./lab/LabScope";
import { ScanField, type ScanOutcome } from "./lab/ScanField";

export function collectOutcome(err: unknown): ScanOutcome {
  if (errorCode(err) === "invalid_transition") return { ok: false, text: "esta amostra já foi coletada ou não está aguardando coleta" };
  return { ok: false, text: labError(err) };
}

export function LabCollection() {
  const queryClient = useQueryClient();
  async function collect(code: string): Promise<ScanOutcome> {
    try {
      const sample = await collectSampleByBarcode(code);
      void refreshLab(queryClient);
      return { ok: true, text: `coleta registrada${sample.requisition_number ? ` · requisição ${sample.requisition_number}` : ""}` };
    } catch (err) {
      return collectOutcome(err);
    }
  }
  return (
    <LabGate title="Coleta" sub="laboratório municipal · registrar a coleta lendo a etiqueta" allow={(r) => r.staff || r.professional}>
      {(roles) => (
        <LabScope roles={roles}>
          {(scope) => (
            <Panel title="Ler etiquetas" sub={scope.kind === "ubs" ? scope.unit.name : scope.providerName}>
              <ScanField label="Etiqueta do tubo" onScan={collect}
                hint="Aponte o leitor para a etiqueta do tubo depois de coletar; cada leitura registra a coleta com o seu nome e a hora." />
            </Panel>
          )}
        </LabScope>
      )}
    </LabGate>
  );
}
