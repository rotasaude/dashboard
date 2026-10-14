// src/modules/exams/UploadField.tsx
// Anexo de guia ou laudo (contrato §3; Divergência D1). Tipo e tamanho são
// conferidos aqui e de novo no api. O arquivo sobe sem o nome, que pode
// trazer o nome do paciente: o nome fica só na tela de quem anexou. Trocar o
// arquivo apaga o anexo anterior; uma resposta atrasada de um arquivo
// trocado é ignorada.
import { useRef, useState } from "react";
import { EXAM_UPLOAD_TYPES, uploadExamFile } from "../../lib/api";
import { examError, uploadProblem } from "../../lib/exams";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, okText } from "./styles";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "error"; text: string };

type Props = { label: string; types?: readonly string[]; uploadId: string | null; onUploaded(uploadId: string | null): void };

export function UploadField({ label, types = EXAM_UPLOAD_TYPES, uploadId, onUploaded }: Props) {
  const [ state, setState ] = useState<State>({ kind: "idle" });
  const [ name, setName ] = useState<string | null>(null);
  const seq = useRef(0);

  async function pick(file: File | null) {
    const mine = ++seq.current;
    onUploaded(null);
    setName(null);
    const pdfOnly = types.length === 1 && types[0] === "application/pdf";
    const wrongType = file && !types.includes(file.type);
    const problem = wrongType ? (pdfOnly ? "envie o laudo em PDF" : "envie PDF, JPEG ou PNG") : uploadProblem(file);
    if (problem || !file) { setState({ kind: "error", text: problem ?? "escolha um arquivo" }); return; }
    setState({ kind: "sending" });
    try {
      const id = await uploadExamFile(file);
      if (mine !== seq.current) return;
      setName(file.name);
      setState({ kind: "idle" });
      onUploaded(id);
    } catch (err) {
      if (mine !== seq.current) return;
      setState({ kind: "error", text: examError(err) });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={fieldLabel}>
        {label}
        <input type="file" accept={types.join(",")} style={inputStyle}
          onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
      </label>
      {state.kind === "sending" && <p role="status" style={muted}>enviando o arquivo…</p>}
      {state.kind === "error" && <p role="alert" style={alert}>{state.text}</p>}
      {uploadId && name && <p role="status" style={okText}>{`anexado: ${name}`}</p>}
    </div>
  );
}
