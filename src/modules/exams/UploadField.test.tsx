// src/modules/exams/UploadField.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, uploadExamFile: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { UploadField } from "./UploadField";
import { pdfFile } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let last: string | null = "inicial";

let types: readonly string[] = [ "application/pdf", "image/jpeg", "image/png" ];

function Harness() {
  const [ id, setId ] = useState<string | null>(null);
  return <UploadField label="Laudo" types={types} uploadId={id} onUploaded={(next) => { last = next; setId(next); }} />;
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText("Laudo"), { target: { files: [ file ] } });
}

afterEach(() => { cleanup(); types = [ "application/pdf", "image/jpeg", "image/png" ]; });

describe("UploadField", () => {
  beforeEach(() => { mocked(api.uploadExamFile).mockReset(); last = "inicial"; });

  it("anexa: mostra o nome só na tela e devolve o upload_id", async () => {
    mocked(api.uploadExamFile).mockResolvedValue("up1");
    render(<Harness />);
    pick(pdfFile("laudo Joana.pdf"));
    expect((await screen.findByText("anexado: laudo Joana.pdf")).getAttribute("role")).toBe("status");
    expect(last).toBe("up1");
    expect(mocked(api.uploadExamFile).mock.calls[0][0].name).toBe("laudo Joana.pdf");
  });

  it("recusa tipo, tamanho e vazio sem chamar o api", async () => {
    render(<Harness />);
    pick(new File([ "x" ], "guia.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    expect((await screen.findByRole("alert")).textContent).toBe("envie PDF, JPEG ou PNG");
    const big = new File([ "x" ], "foto.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 12 * 1024 * 1024 });
    pick(big);
    expect((await screen.findByRole("alert")).textContent).toBe("o arquivo passa de 10 MB");
    pick(new File([], "vazio.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o arquivo está vazio");
    expect(api.uploadExamFile).not.toHaveBeenCalled();
    expect(last).toBeNull();
  });

  it("422 invalid_file: explica e não guarda o anexo", async () => {
    mocked(api.uploadExamFile).mockRejectedValue(new ApiError(422, { error: "invalid_file" }, "x"));
    render(<Harness />);
    pick(pdfFile());
    expect((await screen.findByRole("alert")).textContent).toBe("arquivo inválido — envie PDF, JPEG ou PNG de até 10 MB");
    expect(last).toBeNull();
  });

  it("trocar o arquivo apaga o anexo anterior antes do novo envio", async () => {
    mocked(api.uploadExamFile).mockResolvedValueOnce("up1").mockReturnValueOnce(new Promise(() => {}));
    render(<Harness />);
    pick(pdfFile("a.pdf"));
    await screen.findByText("anexado: a.pdf");
    pick(pdfFile("b.pdf"));
    await waitFor(() => expect(last).toBeNull());
    expect(screen.queryByText("anexado: a.pdf")).toBeNull();
    expect(screen.getByText("enviando o arquivo…")).not.toBeNull();
  });

  it("só PDF: JPEG é recusado sem chamar o api; o nome do arquivo nunca vai no corpo", async () => {
    types = [ "application/pdf" ];
    render(<Harness />);
    pick(new File([ "x" ], "foto.jpg", { type: "image/jpeg" }));
    expect((await screen.findByRole("alert")).textContent).toBe("envie o laudo em PDF");
    expect(api.uploadExamFile).not.toHaveBeenCalled();
  });
});
