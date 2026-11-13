// Módulo 24b (F-24.14): visita domiciliar e atividade coletiva na linha do tempo.
import { describe, expect, it } from "vitest";
import { detailTarget, statusLabel, timelineKindLabel, timelineKinds } from "./timeline";

describe("linha do tempo — visita domiciliar e atividade coletiva", () => {
  it("os dois kinds têm rótulo e só entram no filtro com o interruptor", () => {
    expect(timelineKindLabel("home_visit")).toBe("Visita domiciliar");
    expect(timelineKindLabel("collective_activity")).toBe("Atividade coletiva");
    const off = timelineKinds(false, false, false, false, false, false, false).map((k) => k.key);
    expect(off).not.toContain("home_visit");
    expect(off).not.toContain("collective_activity");
    const on = timelineKinds(false, false, false, false, false, false, false, true, true).map((k) => k.key);
    expect(on).toEqual(expect.arrayContaining([ "home_visit", "collective_activity" ]));
    const onlyVisits = timelineKinds(false, false, false, false, false, false, false, true, false).map((k) => k.key);
    expect(onlyVisits).toContain("home_visit");
    expect(onlyVisits).not.toContain("collective_activity");
  });

  it("retirada tem rótulo; registrada também; a visita não abre detalhe nesta entrega", () => {
    expect(statusLabel("withdrawn")).toBe("retirada");
    expect(statusLabel("recorded")).toBe("registrado");
    expect(detailTarget({ kind: "home_visit", detail_ref: { type: "home_visit", id: "v1" } } as never, true)).toBeNull();
  });
});
