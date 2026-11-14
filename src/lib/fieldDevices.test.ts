import { describe, expect, it } from "vitest";
import { device } from "../test/homeVisitFixtures";
import {
  AUTO_REVOKED_REASONS, REPLACE_NOTICE, REREGISTER_NOTICE, canReplace, deviceStatusLabel, isAutoRevoked, revokeLossWarning
} from "./fieldDevices";

describe("aparelhos de campo (24c): situação, substituição e aviso de perda", () => {
  it.each([
    [ { status: "active" }, "ativo" ],
    [ { status: "inactive" }, "suspenso enquanto sem vínculo" ],
    [ { status: "revoked", revoked_reason: "membership_ended" }, "revogado automaticamente: cadastre de novo" ],
    [ { status: "revoked", revoked_reason: "user_disabled" }, "revogado automaticamente: cadastre de novo" ],
    [ { status: "revoked", revoked_reason: "replaced" }, "revogado: substituído por outro aparelho" ],
    [ { status: "revoked", revoked_reason: "user" }, "revogado: por você" ],
    [ { status: "revoked", revoked_reason: "admin" }, "revogado: pelo administrador" ],
    [ { status: "revoked", revoked_reason: "xpto" }, "revogado: xpto" ],
    [ { status: "revoked", revoked_reason: null }, "revogado" ],
    [ { status: "paused" }, "paused" ]
  ])("dono: %j → %s", (over, label) => expect(deviceStatusLabel(device(over))).toBe(label));

  // Quem olha a lista da cidade não é o dono: nada de "por você" nem de "cadastre de novo".
  it.each([
    [ { status: "inactive" }, "suspenso enquanto sem vínculo" ],
    [ { status: "revoked", revoked_reason: "user" }, "revogado: pela pessoa" ],
    [ { status: "revoked", revoked_reason: "admin" }, "revogado: pela administração" ],
    [ { status: "revoked", revoked_reason: "membership_ended" }, "revogado: fim do vínculo na equipe" ],
    [ { status: "revoked", revoked_reason: "user_disabled" }, "revogado: usuário desativado" ],
    [ { status: "revoked", revoked_reason: "replaced" }, "revogado: substituído por outro aparelho" ]
  ])("administrador: %j → %s", (over, label) => expect(deviceStatusLabel(device(over), "admin")).toBe(label));

  it("aviso de perda: a data do último uso no fuso da cidade, ou nunca usado", () => {
    const used = revokeLossWarning("2026-11-12T10:00:00-03:00");
    expect(used).toContain("O que não foi sincronizado neste aparelho será perdido.");
    expect(used).toContain("12/11/2026");
    expect(used).toMatch(/Último uso: 12\/11\/2026.*10:00\.$/);
    expect(revokeLossWarning(null)).toBe("O que não foi sincronizado neste aparelho será perdido. Último uso: nunca usado.");
  });

  it("substituir só aparelho ativo (Q16)", () => {
    expect(canReplace(device())).toBe(true);
    expect(canReplace(device({ status: "inactive" }))).toBe(false);
    expect(canReplace(device({ status: "revoked", revoked_reason: "membership_ended" }))).toBe(false);
  });

  it("revogado automaticamente: só fim de vínculo e usuário desativado, e só se revogado", () => {
    expect([ ...AUTO_REVOKED_REASONS ]).toEqual([ "membership_ended", "user_disabled" ]);
    expect(isAutoRevoked(device({ status: "revoked", revoked_reason: "membership_ended" }))).toBe(true);
    expect(isAutoRevoked(device({ status: "revoked", revoked_reason: "user_disabled" }))).toBe(true);
    expect(isAutoRevoked(device({ status: "revoked", revoked_reason: "replaced" }))).toBe(false);
    expect(isAutoRevoked(device({ status: "revoked", revoked_reason: "user" }))).toBe(false);
    expect(isAutoRevoked(device({ status: "inactive", revoked_reason: "membership_ended" }))).toBe(false);
  });

  it("os dois avisos dizem que a fila fica guardada no tablet", () => {
    expect(REPLACE_NOTICE).toBe("O aparelho antigo para de sincronizar agora e guarda o que não foi enviado. Leia o QR novo no tablet: no mesmo tablet, o app envia o que ficou guardado.");
    expect(REREGISTER_NOTICE).toBe("Este aparelho foi revogado automaticamente. Cadastre um aparelho novo e leia o QR no mesmo tablet: o app envia o que não foi enviado.");
  });
});
