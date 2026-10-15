import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { openLabPdf } from "./openLabPdf";

describe("openLabPdf", () => {
  let win: { location: { href: string }; close: ReturnType<typeof vi.fn>; opener: unknown };
  beforeEach(() => {
    win = { location: { href: "" }, close: vi.fn(), opener: {} };
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:pdf-1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("abre a janela no clique e põe o blob nela", async () => {
    const out = await openLabPdf(async () => ({ blob: new Blob([ "%PDF" ]), filename: null }));
    expect(out).toEqual({ ok: true });
    expect(win.location.href).toBe("blob:pdf-1");
    expect(win.opener).toBeNull();
  });

  it("revoga o endereço blob depois de um tempo", async () => {
    vi.useFakeTimers({ toFake: [ "setTimeout" ] });
    await openLabPdf(async () => ({ blob: new Blob([ "%PDF" ]), filename: null }));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf-1");
  });

  it("recusa do api fecha a janela e devolve a frase, sem o caminho", async () => {
    const out = await openLabPdf(async () => { throw new ApiError(403, { error: "feature_disabled", feature: "municipal_lab" }, "403 on /lab/requisitions/rq1/labels.pdf"); });
    expect(win.close).toHaveBeenCalled();
    expect(out).toEqual({ ok: false, text: "o laboratório municipal está desligado nesta cidade" });
  });

  it("pop-up bloqueado: não busca o arquivo", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const fetchFile = vi.fn();
    const out = await openLabPdf(fetchFile);
    expect(out.ok).toBe(false);
    expect(fetchFile).not.toHaveBeenCalled();
  });
});
