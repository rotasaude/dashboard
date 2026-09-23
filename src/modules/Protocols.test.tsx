import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real,
    fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), adminFetch: vi.fn(),
    submitProtocol: vi.fn(), signProtocol: vi.fn(), publishProtocolVersion: vi.fn(),
    activateProtocol: vi.fn(), retireProtocol: vi.fn(), revertProtocol: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { ScopeContext } from "../lib/scope";
import { Protocols } from "./Protocols";

afterEach(cleanup);

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ME = "u-me";

function session(role: string): api.SessionUser {
  return {
    id: ME, email_address: "eu@cidade.gov.br", operator: false,
    memberships: [ { municipality_id: "m1", municipality_name: "Curitiba", municipality_uf: "PR", role } ],
    mfa_enrolled: true, mfa_verified_at: new Date().toISOString()
  };
}

const EMPTY_SIGNATURES = {
  publication: { signers: [], missing: 2 },
  activation: { signers: [], missing: 2 }
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "dengue", name: "dengue", version: "1", status: "in_review",
    createdBy: null, publishedBy: null, fourEyes: null, publishedAt: null, retiredAt: null,
    schema: "ok", linter: "ok", gates: "ok",
    signatures: EMPTY_SIGNATURES, eligibleReviewers: 3, editors: [], revertible: false, revertTargetVersion: null,
    ...overrides
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    version: "1", status: "in_review", createdBy: null, publishedBy: null, fourEyes: null,
    at: "2026-09-01T00:00:00Z", schema: "ok", linter: "ok", gates: "ok",
    signatures: EMPTY_SIGNATURES, eligibleReviewers: 3, editors: [], revertible: false, revertTargetVersion: null,
    ...overrides
  };
}

// adminFetch é chamado com "/protocols" (lista) e "/protocols/:id" (detalhe).
function stubReads(rows: unknown[], versions: unknown[] = [ versionRow() ]) {
  mocked(api.adminFetch).mockImplementation((path: string) => {
    if (path === "/protocols") return Promise.resolve({ data: { list: rows }, as_of: "2026-09-22T00:00:00Z" });
    return Promise.resolve({
      data: { id: "dengue", name: "dengue", versions, events: [] }, as_of: "2026-09-22T00:00:00Z"
    });
  });
}

function renderProtocols(role = "protocol_reviewer") {
  mocked(api.fetchCurrentSession).mockResolvedValue(session(role));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider>
          <ScopeContext.Provider value={{ period: "7d", municipalityId: "m1", setPeriod: vi.fn() }}>
            {children}
          </ScopeContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }
  return render(<Protocols />, { wrapper });
}

describe("Protocols", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.adminFetch, api.stepUpMfa, api.submitProtocol,
                       api.signProtocol, api.publishProtocolVersion, api.activateProtocol,
                       api.retireProtocol, api.revertProtocol ]) {
      mocked(fn).mockReset();
    }
  });

  it("mostra assinaturas por finalidade e os revisores elegíveis, sem 4-olhos", async () => {
    stubReads([ row({ signatures: { publication: { signers: [ { id: "u-a", email: "a@c.gov" } ], missing: 1 }, activation: { signers: [], missing: 2 } } }) ]);
    renderProtocols();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("1/2")).not.toBeNull();
    expect(table.getByText("0/2")).not.toBeNull();
    expect(screen.queryByText(/4-olhos/)).toBeNull();
  });

  it("conta e filtra 'aguardando sua assinatura'", async () => {
    stubReads([
      row({ id: "dengue", name: "dengue", status: "in_review" }),
      row({ id: "zika", name: "zika", status: "draft" })
    ]);
    renderProtocols("protocol_reviewer");

    // A StatTile fica dentro de um <button> (o cartão clicável) — o closest
    // "div" mais próximo é só a metade do cartão (rótulo + badge), sem o
    // valor; por isso escopamos pelo <button>, que contém o cartão inteiro.
    const kpi = (await screen.findByText("Aguardando sua assinatura")).closest("button")!;
    // dengue está em revisão e eu sou revisor sem assinatura: 1.
    // A contagem é lida DENTRO do cartão: "1" também aparece na coluna Versão.
    expect(within(kpi).getByText("1")).not.toBeNull();

    fireEvent.click(screen.getByText("Aguardando sua assinatura"));

    await waitFor(() => expect(screen.queryByText("zika")).toBeNull());
    expect(screen.getByText("dengue")).not.toBeNull();
  });

  it("o detalhe mostra quem assinou, quem editou e o mantenedor por extenso", async () => {
    stubReads([ row() ], [ versionRow({
      signatures: { publication: { signers: [ { id: "u-a", email: "ana@c.gov" } ], missing: 1 }, activation: { signers: [], missing: 2 } },
      editors: [ { kind: "user", id: "u-b", email: "autor@c.gov" }, { kind: "maintainer", id: "m-1", email: null } ]
    }) ]);
    renderProtocols();

    fireEvent.click(await screen.findByText("dengue"));

    expect(await screen.findByText("ana@c.gov")).not.toBeNull();
    expect(screen.getByText("autor@c.gov")).not.toBeNull();
    expect(screen.getByText("mantenedor")).not.toBeNull();
  });

  it("revisor assina a publicação com step-up", async () => {
    stubReads([ row() ]);
    mocked(api.signProtocol).mockResolvedValue(undefined);
    renderProtocols("protocol_reviewer");

    fireEvent.click(await screen.findByText("dengue"));
    fireEvent.click(await screen.findByRole("button", { name: "Assinar publicação" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(api.signProtocol).toHaveBeenCalledWith("dengue", "1", "publication"));
    expect((await screen.findByRole("status")).textContent).toBe("Assinar publicação concluído: dengue v1");
  });

  it("quem editou a versão vê a assinatura desabilitada com o motivo", async () => {
    stubReads([ row() ], [ versionRow({ editors: [ { kind: "user", id: ME, email: "eu@cidade.gov.br" } ] }) ]);
    renderProtocols("protocol_reviewer");

    fireEvent.click(await screen.findByText("dengue"));

    const button = await screen.findByRole("button", { name: "Assinar publicação" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("você editou esta versão")).not.toBeNull();
  });

  it("publisher vê Publicar bloqueado pelo que falta", async () => {
    stubReads([ row() ], [ versionRow({ signatures: { publication: { signers: [], missing: 1 }, activation: { signers: [], missing: 2 } } }) ]);
    renderProtocols("protocol_publisher");

    fireEvent.click(await screen.findByText("dengue"));

    const button = await screen.findByRole("button", { name: "Publicar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("falta 1 assinatura")).not.toBeNull();
    // D3 — um botão desabilitado precisa PARECER desabilitado.
    expect(button.style.opacity).toBe("0.55");
    expect(button.style.cursor).toBe("not-allowed");
  });

  it("reverter pede motivo e manda nome e motivo", async () => {
    stubReads([ row({ status: "active", revertible: true }) ], [ versionRow({ status: "active", revertible: true }) ]);
    mocked(api.revertProtocol).mockResolvedValue(undefined);
    renderProtocols("protocol_publisher");

    fireEvent.click(await screen.findByText("dengue"));
    fireEvent.click(await screen.findByRole("button", { name: "Reverter" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "regra errada" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(api.revertProtocol).toHaveBeenCalledWith("dengue", "regra errada"));
  });

  it("a recusa da API aparece e o painel continua aberto", async () => {
    stubReads([ row() ]);
    mocked(api.signProtocol).mockRejectedValue(new ApiError(422, { error: "invalid_state", message: "só in_review aceita assinatura" }, "422"));
    renderProtocols("protocol_reviewer");

    fireEvent.click(await screen.findByText("dengue"));
    fireEvent.click(await screen.findByRole("button", { name: "Assinar publicação" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("só in_review aceita assinatura")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar" })).not.toBeNull();
  });

  it("sucesso recarrega lista e detalhe", async () => {
    stubReads([ row() ]);
    mocked(api.signProtocol).mockResolvedValue(undefined);
    renderProtocols("protocol_reviewer");

    fireEvent.click(await screen.findByText("dengue"));
    const before = mocked(api.adminFetch).mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Assinar publicação" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(mocked(api.adminFetch).mock.calls.length).toBeGreaterThan(before + 1));
  });

  // D7 — depois de cada ação bem-sucedida (§5.2), recarrega também a sessão.
  it("sucesso também recarrega a sessão", async () => {
    stubReads([ row() ]);
    mocked(api.signProtocol).mockResolvedValue(undefined);
    renderProtocols("protocol_reviewer");

    fireEvent.click(await screen.findByText("dengue"));
    const before = mocked(api.fetchCurrentSession).mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Assinar publicação" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(mocked(api.fetchCurrentSession).mock.calls.length).toBeGreaterThan(before));
  });

  // D7 — e-mail ausente em signatário ou editor mostra "—", nunca o UUID.
  it("signatário e editor sem e-mail mostram travessão, não o UUID", async () => {
    stubReads([ row() ], [ versionRow({
      signatures: { publication: { signers: [ { id: "u-no-email", email: null } ], missing: 1 }, activation: { signers: [], missing: 2 } },
      editors: [ { kind: "user", id: "u-editor-no-email", email: null } ]
    }) ]);
    renderProtocols();

    fireEvent.click(await screen.findByText("dengue"));

    expect((await screen.findAllByText("—")).length).toBe(2); // signatário + editor
    expect(screen.queryByText("u-no-email")).toBeNull();
    expect(screen.queryByText("u-editor-no-email")).toBeNull();
  });

  // D5 — a reversão precisa declarar o efeito (spec de assinaturas §6): não
  // encadeia, e a versão-alvo tem de continuar publicada.
  it("reverter mostra a regra do §6 antes de confirmar", async () => {
    stubReads(
      [ row({ status: "active", revertible: true, version: "3", revertTargetVersion: "2" }) ],
      [ versionRow({ status: "active", revertible: true, version: "3", revertTargetVersion: "2" }) ]
    );
    renderProtocols("protocol_publisher");

    fireEvent.click(await screen.findByText("dengue"));
    fireEvent.click(await screen.findByRole("button", { name: "Reverter" }));

    expect(await screen.findByText(/versão 2, que estava em uso antes desta/)).not.toBeNull();
    expect(screen.getByText(/não encadeia/i)).not.toBeNull();
  });

  it("o painel de reverter nomeia a versão que deve voltar", async () => {
    stubReads(
      [ row({ status: "active", revertible: true, version: "3", revertTargetVersion: "2" }) ],
      [ versionRow({ status: "active", revertible: true, version: "3", revertTargetVersion: "2" }) ]
    );
    renderProtocols("protocol_publisher");

    fireEvent.click(await screen.findByText("dengue"));
    fireEvent.click(await screen.findByRole("button", { name: "Reverter" }));

    expect(await screen.findByText(/deve voltar para a versão 2/)).not.toBeNull();
    expect(screen.getByText(/Não encadeia/)).not.toBeNull();
  });

  it("sem alvo na leitura, o painel cai na frase sem número", async () => {
    stubReads(
      [ row({ status: "active", revertible: true, version: "3", revertTargetVersion: null }) ],
      [ versionRow({ status: "active", revertible: true, version: "3", revertTargetVersion: null }) ]
    );
    renderProtocols("protocol_publisher");

    fireEvent.click(await screen.findByText("dengue"));
    fireEvent.click(await screen.findByRole("button", { name: "Reverter" }));

    expect(await screen.findByText(/versão ativada antes desta/)).not.toBeNull();
    expect(screen.queryByText(/versão null/)).toBeNull();
  });

  // D6 — Schema e Linter são strings fixas na API ("ok"); a tela não pode
  // afirmar que passaram por um portão que nunca rodou.
  it("a lista não mostra as colunas Schema e Linter", async () => {
    stubReads([ row() ]);
    renderProtocols();

    await screen.findByText("dengue");
    expect(screen.queryByText("Schema")).toBeNull();
    expect(screen.queryByText("Linter")).toBeNull();
  });

  it("quem só tem viewer não vê ação nenhuma", async () => {
    stubReads([ row() ]);
    renderProtocols("viewer");

    fireEvent.click(await screen.findByText("dengue"));

    await screen.findByText("Versões");
    expect(screen.queryByRole("button", { name: "Assinar publicação" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publicar" })).toBeNull();
  });

  // D1 — a leitura da API agora devolve "active" sem colapsar em "published"
  // (A1). A tela precisa distinguir as duas na tag e nas ações oferecidas.
  it("rótulos em português para os cinco status, sem texto cru em inglês", async () => {
    stubReads([
      row({ id: "a", name: "a", status: "draft" }),
      row({ id: "b", name: "b", status: "in_review" }),
      row({ id: "c", name: "c", status: "published" }),
      row({ id: "d", name: "d", status: "active" }),
      row({ id: "e", name: "e", status: "retired" })
    ]);
    renderProtocols("viewer");

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("rascunho")).not.toBeNull();
    expect(table.getByText("em revisão")).not.toBeNull();
    expect(table.getByText("publicada")).not.toBeNull();
    expect(table.getByText("em uso")).not.toBeNull();
    expect(table.getByText("aposentada")).not.toBeNull();
    for (const raw of [ "draft", "in_review", "published", "active", "retired" ]) {
      expect(table.queryByText(raw)).toBeNull();
    }
  });

  it("versão active oferece só Reverter — nunca Aposentar, Ativar ou Assinar ativação", async () => {
    stubReads(
      [ row({ status: "active", revertible: true }) ],
      [ versionRow({ status: "active", revertible: true }) ]
    );
    renderProtocols("protocol_publisher");

    fireEvent.click(await screen.findByText("dengue"));

    expect(await screen.findByRole("button", { name: "Reverter" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Aposentar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ativar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Assinar ativação" })).toBeNull();
  });

  it("versão published continua oferecendo Ativar e Aposentar", async () => {
    stubReads(
      [ row({ status: "published" }) ],
      [ versionRow({ status: "published", signatures: { publication: EMPTY_SIGNATURES.publication, activation: { signers: [], missing: 0 } } }) ]
    );
    renderProtocols("protocol_publisher");

    fireEvent.click(await screen.findByText("dengue"));

    expect(await screen.findByRole("button", { name: "Ativar" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Aposentar" })).not.toBeNull();
  });

  it("o KPI 'Aguardando sua assinatura' não conta a versão active", async () => {
    stubReads([ row({ id: "dengue", name: "dengue", status: "active", revertible: true }) ]);
    renderProtocols("protocol_reviewer");

    const kpi = (await screen.findByText("Aguardando sua assinatura")).closest("button")!;
    expect(within(kpi).getByText("0")).not.toBeNull();
  });

  // D4 — o filtro "aguardando sua assinatura" precisa de um estado visível
  // (aria-pressed + contorno) e de um vazio próprio quando ligado.
  it("o cartão-filtro expõe aria-pressed e ganha contorno quando ligado", async () => {
    stubReads([ row({ id: "dengue", name: "dengue", status: "in_review" }) ]);
    renderProtocols("protocol_reviewer");

    const toggle = (await screen.findByText("Aguardando sua assinatura")).closest("button")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.style.outline === "" || toggle.style.outline === "2px solid transparent").toBe(true);

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.style.outline).not.toBe("");
    expect(toggle.style.outline).not.toBe("2px solid transparent");
  });

  it("com o filtro ligado e nada pendente, mostra o vazio próprio do filtro", async () => {
    stubReads([ row({ id: "zika", name: "zika", status: "draft" }) ]);
    renderProtocols("protocol_reviewer");

    fireEvent.click(await screen.findByText("Aguardando sua assinatura"));

    expect(await screen.findByText("nenhuma versão aguardando sua assinatura")).not.toBeNull();
    expect(screen.queryByText("nenhum protocolo cadastrado")).toBeNull();
  });

  it("sem filtro, a lista vazia mostra o texto genérico", async () => {
    stubReads([]);
    renderProtocols("protocol_reviewer");

    expect(await screen.findByText("nenhum protocolo cadastrado")).not.toBeNull();
  });

  // D2 — revisor sem autenticador cadastrado precisa de uma saída até a
  // Segurança, como Team.tsx já oferece.
  it("sem autenticador cadastrado, o botão de cadastro navega para Segurança", async () => {
    stubReads([ row() ]);
    mocked(api.fetchCurrentSession).mockResolvedValue({ ...session("protocol_reviewer"), mfa_enrolled: false });
    const onNavigate = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <ScopeContext.Provider value={{ period: "7d", municipalityId: "m1", setPeriod: vi.fn() }}>
            <Protocols onNavigate={onNavigate} />
          </ScopeContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByText("dengue"));
    fireEvent.click(await screen.findByRole("button", { name: "Assinar publicação" }));
    fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));

    expect(onNavigate).toHaveBeenCalledWith("security");
  });

  // D1 — a leitura agora distingue "active" (em uso) de "published" (apenas
  // publicada); para o KPI "Publicados" as duas contam, então uma versão
  // active não pode sumir da contagem.
  it("o KPI 'Publicados' conta a versão active junto com published", async () => {
    stubReads([
      row({ id: "dengue", name: "dengue", status: "active", revertible: true }),
      row({ id: "zika", name: "zika", status: "published" }),
      row({ id: "sarampo", name: "sarampo", status: "draft" })
    ]);
    renderProtocols("viewer");

    await screen.findByText("dengue");
    // A StatTile "Publicados" não fica num <button> (diferente de "Aguardando
    // sua assinatura"); o valor mora num <div> irmão do <div> que tem o
    // rótulo, então subimos até o <div>-cartão (avô do rótulo) para ler o
    // valor só dentro do próprio cartão.
    const kpi = (await screen.findByText("Publicados")).closest("div")!.parentElement!;
    expect(within(kpi).getByText("2")).not.toBeNull();
  });
});
