// src/modules/documents/printDocument.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchDocumentPdf: vi.fn() };
});

import * as api from "../../lib/api";
import { POPUP_BLOCKED, printDocument } from "./printDocument";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const pdf = () => ({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: null });
let win: { location: { href: string }; close: ReturnType<typeof vi.fn> };
let revoke: ReturnType<typeof vi.fn>;

describe("printDocument", () => {
  beforeEach(() => {
    mocked(api.fetchDocumentPdf).mockReset();
    win = { location: { href: "" }, close: vi.fn() };
    revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:doc1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("aponta a janela para o blob e revoga o endereço depois de 60 s", async () => {
    vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
    vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    mocked(api.fetchDocumentPdf).mockResolvedValue(pdf());
    expect(await printDocument("doc1", () => "erro")).toBeNull();
    expect(win.location.href).toBe("blob:doc1");
    vi.advanceTimersByTime(59_999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:doc1");
  });

  it("pop-up bloqueado: devolve a frase sem ler o PDF", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    expect(await printDocument("doc1", () => "erro")).toBe(POPUP_BLOCKED);
    expect(api.fetchDocumentPdf).not.toHaveBeenCalled();
  });

  it("recusa do api: fecha a janela e devolve a frase de quem chama", async () => {
    vi.spyOn(window, "open").mockImplementation(() => win as unknown as Window);
    const err = new api.ApiError(409, { error: "awaiting_signature" }, "409");
    mocked(api.fetchDocumentPdf).mockRejectedValue(err);
    const errorText = vi.fn(() => "frase");
    expect(await printDocument("doc1", errorText)).toBe("frase");
    expect(errorText).toHaveBeenCalledWith(err);
    expect(win.close).toHaveBeenCalled();
  });
});
