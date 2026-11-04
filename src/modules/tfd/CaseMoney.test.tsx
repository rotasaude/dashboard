import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { renderWithProviders } from "../../test/campaignFixtures";
import { NOW30, TODAY30, tfdCase, tfdLeg, tfdRow, trUser } from "../../test/transportFixtures";
import { LegsPanel } from "./LegsPanel";
import { AllowancesPanel } from "./AllowancesPanel";
import { PaymentForm } from "./PaymentForm";
import { AccountabilityForm } from "./AccountabilityForm";
import { TfdQueue } from "../TfdQueue";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), addTfdLeg: vi.fn(), markTfdLegDone: vi.fn(),
  recordTfdPayment: vi.fn(), uploadTfdAccountability: vi.fn(), getTfdAccountabilityUrl: vi.fn(), fetchTfdAccountabilityFile: vi.fn(), listTfdCases: vi.fn(), readTfdCase: vi.fn(),
  listTfdAllowances: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
const authorized = tfdCase({ status: "authorized", appointment_at: "2026-11-20T08:00:00-03:00",
  trip_passengers: [ { id: "p5", date: "2026-11-20", departure_at: "2026-11-20T04:00:00-03:00", attendance: "pending", companion_attendance: null } ] });
const as = () => vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "tfd_committee" ]));
const refusal = (status: number, body: Record<string, unknown>) => new ApiError(status, body, String(status));

describe("trechos", () => {
  it("frota: escolhe a viagem do paciente; passagem: valor e empresa; km vem do destino", async () => {
    as();
    vi.mocked(api.addTfdLeg).mockResolvedValue(authorized);
    renderWithProviders(<LegsPanel tfdCase={authorized} today={TODAY30} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo trecho" }));
    const form = screen.getByRole("form", { name: "Trecho" });
    expect(within(form).getByText("110 km (do cadastro do destino)")).not.toBeNull();
    expect(within(form).getByRole("option", { name: "20/11/2026 saída 04:00" })).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Data"), { target: { value: "2026-11-20" } });
    fireEvent.change(within(form).getByLabelText("Viagem da frota"), { target: { value: "p5" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.addTfdLeg).toHaveBeenCalledWith("c1", { direction: "outbound", mode: "fleet", date: "2026-11-20", trip_passenger_id: "p5" }));
  });

  it("frota sem viagem: frase para a central; ida de frota em outra data recusa antes de enviar", async () => {
    as();
    const noTrip = tfdCase({ status: "authorized" });
    const { unmount } = renderWithProviders(<LegsPanel tfdCase={noTrip} today={TODAY30} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo trecho" }));
    expect(screen.getByText("o paciente ainda não está numa viagem da frota — peça à central")).not.toBeNull();
    expect(screen.queryByLabelText("Viagem da frota")).toBeNull();
    unmount();
    renderWithProviders(<LegsPanel tfdCase={authorized} today={TODAY30} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo trecho" }));
    const form = screen.getByRole("form", { name: "Trecho" });
    fireEvent.change(within(form).getByLabelText("Viagem da frota"), { target: { value: "p5" } });
    // Escolher a viagem traz a data dela na ida.
    expect((within(form).getByLabelText("Data") as HTMLInputElement).value).toBe("2026-11-20");
    fireEvent.change(within(form).getByLabelText("Data"), { target: { value: "2026-11-21" } });
    fireEvent.submit(form);
    expect(screen.getByText("na frota, a data da ida é a da viagem escolhida")).not.toBeNull();
    expect(api.addTfdLeg).not.toHaveBeenCalled();
  });

  it("passagem: valor com milhar em centavos, empresa, sem campo vazio; volta sem ida recusa", async () => {
    as();
    const c = tfdCase({ status: "authorized", report: { ...tfdCase().report, transport_mode: "bus_ticket" } });
    const onChanged = vi.fn();
    vi.mocked(api.addTfdLeg).mockResolvedValue({ ...c, status: "scheduled" });
    renderWithProviders(<LegsPanel tfdCase={c} today={TODAY30} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo trecho" }));
    const form = screen.getByRole("form", { name: "Trecho" });
    expect((within(form).getByLabelText("Modal") as HTMLSelectElement).value).toBe("bus_ticket");
    expect(within(form).queryByLabelText("Acompanhante viaja junto")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Sentido"), { target: { value: "return" } });
    fireEvent.change(within(form).getByLabelText("Data"), { target: { value: "2026-11-21" } });
    fireEvent.change(within(form).getByLabelText("Valor da passagem"), { target: { value: "1.085,50" } });
    fireEvent.change(within(form).getByLabelText("Empresa"), { target: { value: "  Viação Sul " } });
    fireEvent.submit(form);
    expect(screen.getByText("registre a ida antes da volta")).not.toBeNull();
    expect(api.addTfdLeg).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Sentido"), { target: { value: "outbound" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.addTfdLeg).toHaveBeenCalledWith("c1",
      { direction: "outbound", mode: "bus_ticket", date: "2026-11-21", ticket: { amount_cents: 108550, carrier: "Viação Sul" } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }), "Trecho registrado."));
  });

  it("recusa do api no trecho aparece traduzida; duplo envio grava uma vez", async () => {
    as();
    let fail!: (e: unknown) => void;
    vi.mocked(api.addTfdLeg).mockImplementation(() => new Promise((_res, rej) => { fail = rej; }) as never);
    renderWithProviders(<LegsPanel tfdCase={authorized} today={TODAY30} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo trecho" }));
    const form = screen.getByRole("form", { name: "Trecho" });
    fireEvent.change(within(form).getByLabelText("Viagem da frota"), { target: { value: "p5" } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(api.addTfdLeg).toHaveBeenCalledTimes(1);
    fail(refusal(422, { error: "invalid_request", path: "trip_passenger_id" }));
    expect(await screen.findByText("esta viagem não serve a este paciente — escolha outra")).not.toBeNull();
  });

  it("trecho de passagem realizado: botão próprio; o de frota não tem; anulado aparece e não conta", async () => {
    as();
    const c = tfdCase({ status: "scheduled", legs: [
      tfdLeg({ id: "l1", direction: "outbound", mode: "fleet", date: "2026-11-01", trip_passenger_id: "p5", ticket: null }),
      tfdLeg({ id: "l2", direction: "return", mode: "bus_ticket", date: "2026-11-02", ticket: { amount_cents: 8500, carrier: "Viação Sul" }, outbound_leg_id: "l1" }),
      tfdLeg({ id: "l3", direction: "outbound", mode: "fleet", date: "2026-10-30", trip_passenger_id: "p4", ticket: null, voided: true }) ] });
    const onChanged = vi.fn();
    vi.mocked(api.markTfdLegDone).mockResolvedValue({ ...c, legs: [ c.legs[0], { ...c.legs[1], done: true }, c.legs[2] ] });
    renderWithProviders(<LegsPanel tfdCase={c} today={TODAY30} onChanged={onChanged} />);
    expect(await screen.findByText("o trecho da frota se cumpre com o embarque marcado pelo motorista")).not.toBeNull();
    expect(screen.getByText("R$ 85,00 · Viação Sul")).not.toBeNull();
    expect(screen.getByText("anulado")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /como realizada/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Marcar volta de 02/11/2026 como realizada" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.markTfdLegDone).toHaveBeenCalledWith("l2"));
    expect(api.markTfdLegDone).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), "Trecho dado como realizado."));
  });

  it("passagem de data futura não tem baixa; recusa do api na baixa aparece", async () => {
    as();
    const c = tfdCase({ status: "scheduled", legs: [
      tfdLeg({ id: "l1", direction: "outbound", date: "2026-11-02", ticket: { amount_cents: 8500, carrier: "Viação Sul" } }),
      tfdLeg({ id: "l2", direction: "return", date: "2026-11-21", ticket: { amount_cents: 8500, carrier: "Viação Sul" }, outbound_leg_id: "l1" }) ] });
    vi.mocked(api.markTfdLegDone).mockRejectedValue(refusal(422, { error: "invalid_transition" }));
    renderWithProviders(<LegsPanel tfdCase={c} today={TODAY30} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Marcar volta de 21/11/2026 como realizada" }));
    expect(screen.getByText("o trecho é de data futura — dê baixa a partir do dia")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marcar ida de 02/11/2026 como realizada" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o processo mudou de situação — feche e abra de novo")).not.toBeNull();
  });

  it("sentido padrão: volta com ida em aberto; ida quando todos os pares estão completos", async () => {
    as();
    const open = tfdCase({ status: "scheduled", legs: [ tfdLeg({ id: "o1", direction: "outbound", date: "2026-11-01" }) ] });
    const first = renderWithProviders(<LegsPanel tfdCase={open} today={TODAY30} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo trecho" }));
    expect((screen.getByLabelText("Sentido") as HTMLSelectElement).value).toBe("return");
    first.unmount();
    const paired = tfdCase({ status: "travelling", legs: [ tfdLeg({ id: "o1", direction: "outbound", date: "2026-11-01", done: true }),
      tfdLeg({ id: "r1", direction: "return", date: "2026-11-02", outbound_leg_id: "o1", done: true }) ] });
    renderWithProviders(<LegsPanel tfdCase={paired} today={TODAY30} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo trecho" }));
    expect((screen.getByLabelText("Sentido") as HTMLSelectElement).value).toBe("outbound");
  });

  it("sem novo trecho fora de autorizado/agendado/em viagem", async () => {
    as();
    renderWithProviders(<LegsPanel tfdCase={tfdCase({ status: "completed" })} today={TODAY30} onChanged={() => {}} />);
    expect(await screen.findByText("nenhum trecho registrado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Novo trecho" })).toBeNull();
  });
});

describe("ajuda de custo e pagamento", () => {
  it("ajuda calculada pelo api: tabela, complemento e total; pago de devido", async () => {
    as();
    const c = tfdCase({ status: "travelling",
      allowances: [ { id: "a1", person: "patient", kind: "meal_overnight", sigtap_code: "0803010125", quantity: 1, table_cents: 2475, complement_cents: 1000, total_cents: 3475 },
        { id: "a2", person: "companion", kind: "meal_overnight", sigtap_code: "0803010133", quantity: 1, table_cents: 2475, complement_cents: 0, total_cents: 2475 } ],
      payments: [ { id: "py1", paid_on: TODAY30, amount_cents: 3000, method: "pix", receipt_number: "R-1", by_name: "Ana" } ] });
    renderWithProviders(<AllowancesPanel tfdCase={c} />);
    expect((await screen.findByText(/Total devido/)).textContent?.replace(/\s/g, " ")).toBe("Total devido: R$ 59,50 · pago R$ 30,00");
    expect(screen.getByText("acompanhante")).not.toBeNull();
    expect(screen.getByText("O valor é calculado pela regra (tabela SIGTAP da competência + complemento da cidade); a tela não recalcula.")).not.toBeNull();
    expect(screen.getByText("0803010133")).not.toBeNull();
    expect(api.listTfdAllowances).not.toHaveBeenCalled();
  });

  it("sem ajuda: a frase de quando ela é calculada; código desconhecido aparece cru", async () => {
    as();
    const { unmount } = renderWithProviders(<AllowancesPanel tfdCase={tfdCase({ status: "scheduled" })} />);
    expect(await screen.findByText("a ajuda de custo é calculada quando a volta é marcada como realizada")).not.toBeNull();
    unmount();
    renderWithProviders(<AllowancesPanel tfdCase={tfdCase({ status: "travelling", allowances: [
      { id: "a9", person: "guardian", kind: "hotel", sigtap_code: "0803019999", quantity: 2, table_cents: 100, complement_cents: 0, total_cents: 200 } ] })} />);
    expect(await screen.findByText("guardian")).not.toBeNull();
    expect(screen.getByText("hotel")).not.toBeNull();
  });

  it("pagamento: data futura recusa; valor com milhar vai em centavos; step-up confirma", async () => {
    as();
    const scheduled = { ...authorized, status: "scheduled" };
    const onSaved = vi.fn();
    vi.mocked(api.recordTfdPayment).mockResolvedValue(scheduled);
    renderWithProviders(<PaymentForm tfdCase={scheduled} today={TODAY30} onSaved={onSaved} />);
    const form = await screen.findByRole("form", { name: "Pagamento registrado" });
    expect((within(form).getByLabelText("Pago em") as HTMLInputElement).value).toBe(TODAY30);
    fireEvent.change(within(form).getByLabelText("Pago em"), { target: { value: "2026-11-04" } });
    fireEvent.submit(form);
    expect(screen.getByText("a data do pagamento não pode ser futura")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Pago em"), { target: { value: TODAY30 } });
    fireEvent.change(within(form).getByLabelText("Valor"), { target: { value: "1.234,56" } });
    fireEvent.change(within(form).getByLabelText("Forma"), { target: { value: "transfer" } });
    fireEvent.change(within(form).getByLabelText("Número do recibo"), { target: { value: "R-77" } });
    fireEvent.submit(form);
    expect(api.recordTfdPayment).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.recordTfdPayment).toHaveBeenCalledWith("c1", { paid_on: TODAY30, amount_cents: 123456, method: "transfer", receipt_number: "R-77" }));
    expect(api.recordTfdPayment).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(scheduled));
    expect(screen.getByText("O pagamento registrado não se apaga nem se edita.")).not.toBeNull();
  });

  it("pagamento: recibo repetido (409) mostra a frase; fora de agendado/em viagem não há formulário", async () => {
    as();
    const travelling = tfdCase({ status: "travelling",
      payments: [ { id: "py1", paid_on: "2026-11-01", amount_cents: 3000, method: "pix", receipt_number: "R-1", by_name: "Ana" } ] });
    vi.mocked(api.recordTfdPayment).mockRejectedValue(refusal(409, { error: "receipt_taken", path: "receipt_number" }));
    const { unmount } = renderWithProviders(<PaymentForm tfdCase={travelling} today={TODAY30} onSaved={() => {}} />);
    const form = await screen.findByRole("form", { name: "Pagamento registrado" });
    expect(within(screen.getByRole("table")).getByText("Pix")).not.toBeNull();
    expect(screen.getByText("Ana")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Valor"), { target: { value: "30" } });
    fireEvent.change(within(form).getByLabelText("Forma"), { target: { value: "cash" } });
    fireEvent.change(within(form).getByLabelText("Número do recibo"), { target: { value: "R-1" } });
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("já existe pagamento com este número de recibo neste processo")).not.toBeNull();
    unmount();
    renderWithProviders(<PaymentForm tfdCase={authorized} today={TODAY30} onSaved={() => {}} />);
    expect(await screen.findByText("o pagamento se registra com o processo agendado ou em viagem")).not.toBeNull();
    expect(screen.queryByRole("form", { name: "Pagamento registrado" })).toBeNull();
  });
});

describe("prestação de contas (Review Focus 5)", () => {
  it("comprovante grande ou de outro tipo não sai; duplo clique envia uma vez", async () => {
    as();
    let finish!: (c: unknown) => void;
    vi.mocked(api.uploadTfdAccountability).mockImplementation(() => new Promise((res) => { finish = res; }) as never);
    renderWithProviders(<AccountabilityForm tfdCase={tfdCase({ status: "travelling" })} onDone={() => {}} />);
    const input = (await screen.findByLabelText("Comprovante de comparecimento")) as HTMLInputElement;
    expect(input.accept).toBe("application/pdf,image/jpeg,image/png");
    const big = new File([ new Uint8Array(12 * 1024 * 1024) ], "grande.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [ big ] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar e concluir o processo" }));
    expect(screen.getByText("o comprovante passa de 10 MB")).not.toBeNull();
    const doc = new File([ "x" ], "a.docx", { type: "application/msword" });
    fireEvent.change(input, { target: { files: [ doc ] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar e concluir o processo" }));
    expect(screen.getByText("o comprovante precisa ser PDF, JPG ou PNG")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    // A guarda é esta: o cliente (único que lê o arquivo em base64) não foi chamado.
    expect(api.uploadTfdAccountability).not.toHaveBeenCalled();
    const png = new File([ new Uint8Array(200 * 1024) ], "comprovante-maria.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [ png ] } });
    expect(screen.getByText("arquivo escolhido: PNG, 200 KB")).not.toBeNull();
    const send = screen.getByRole("button", { name: "Enviar e concluir o processo" });
    fireEvent.click(send);
    fireEvent.click(send);
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.uploadTfdAccountability).toHaveBeenCalledTimes(1);
    expect(api.uploadTfdAccountability).toHaveBeenCalledWith("c1", png);
    expect(screen.queryByText(/comprovante-maria/)).toBeNull();
    finish(tfdCase({ status: "completed", accountability: { closed_at: "2026-11-03T10:00:00-03:00", document: { id: "f1", filename: "comprovante.png" } } }));
    expect(await screen.findByText("Processo concluído com a prestação de contas.")).not.toBeNull();
    expect(screen.getByText("comprovante enviado em 03/11/2026")).not.toBeNull();
    expect(screen.queryByText(/comprovante\.png/)).toBeNull();
  });

  it("o cliente manda só tipo e conteúdo em base64, nunca o nome do arquivo", async () => {
    const real = await vi.importActual<typeof api>("../../lib/api");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(tfdCase({ status: "completed" })),
      { status: 200, headers: { "Content-Type": "application/json" } }));
    await real.uploadTfdAccountability("c1", new File([ "%PDF-1" ], "laudo-maria-silva.pdf", { type: "application/pdf" }));
    const [ url, init ] = fetchSpy.mock.calls[0] as [ string, RequestInit ];
    expect(url).not.toContain("maria");
    expect(JSON.parse(String(init.body))).toEqual({ content_type: "application/pdf", data: btoa("%PDF-1") });
  });

  it("trecho sem baixa barra antes de enviar (frota: peça à central); recusa do api libera o arquivo", async () => {
    as();
    const pdf = () => new File([ "%PDF" ], "x.pdf", { type: "application/pdf" });
    const ticketOpen = tfdCase({ status: "travelling", legs: [ tfdLeg({ id: "l1", date: "2026-11-01", done: false }) ] });
    const first = renderWithProviders(<AccountabilityForm tfdCase={ticketOpen} onDone={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Comprovante de comparecimento"), { target: { files: [ pdf() ] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar e concluir o processo" }));
    expect(screen.getByText("há trecho sem baixa — dê baixa antes da prestação de contas")).not.toBeNull();
    first.unmount();
    const fleetOpen = tfdCase({ status: "travelling", legs: [ tfdLeg({ id: "l1", mode: "fleet", ticket: null, trip_passenger_id: "p5", date: "2026-11-01" }) ] });
    const second = renderWithProviders(<AccountabilityForm tfdCase={fleetOpen} onDone={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Comprovante de comparecimento"), { target: { files: [ pdf() ] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar e concluir o processo" }));
    expect(screen.getByText("o trecho da frota fecha com a viagem — peça à central")).not.toBeNull();
    expect(api.uploadTfdAccountability).not.toHaveBeenCalled();
    second.unmount();
    vi.mocked(api.uploadTfdAccountability).mockRejectedValue(refusal(422, { error: "invalid_file" }));
    renderWithProviders(<AccountabilityForm tfdCase={tfdCase({ status: "travelling", legs: [ tfdLeg({ voided: true }) ] })} onDone={() => {}} />);
    const again = (await screen.findByLabelText("Comprovante de comparecimento")) as HTMLInputElement;
    fireEvent.change(again, { target: { files: [ pdf() ] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar e concluir o processo" }));
    expect(again.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("o comprovante precisa ser PDF, JPG ou PNG de até 10 MB")).not.toBeNull();
    expect(again.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Enviar e concluir o processo" })).not.toBeNull();
  });

  describe("abrir o comprovante", () => {
    const done = tfdCase({ status: "completed", accountability: { closed_at: "2026-11-02T10:00:00-03:00", document: { id: "f1", filename: "comprovante-2026-11-02.pdf" } } });
    const fakeWindow = () => ({ opener: {} as unknown, location: { href: "" }, close: vi.fn() });
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    afterEach(() => { URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke; });

    it("a janela abre no clique, sem opener, e recebe o arquivo por blob:", async () => {
      as();
      const win = fakeWindow();
      const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
      URL.createObjectURL = vi.fn(() => "blob:proof1");
      URL.revokeObjectURL = vi.fn();
      const blob = new Blob([ "%PDF" ], { type: "application/pdf" });
      vi.mocked(api.getTfdAccountabilityUrl).mockResolvedValue("/tfd/files/tok1");
      vi.mocked(api.fetchTfdAccountabilityFile).mockResolvedValue({ blob, filename: "comprovante-2026-11-02.pdf" });
      renderWithProviders(<AccountabilityForm tfdCase={done} onDone={() => {}} />);
      expect(await screen.findByText("comprovante enviado em 02/11/2026")).not.toBeNull();
      expect(screen.queryByLabelText("Comprovante de comparecimento")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Abrir o comprovante" }));
      // Ainda dentro do clique, antes de qualquer resposta.
      expect(open).toHaveBeenCalledWith("", "_blank");
      expect(win.opener).toBeNull();
      await waitFor(() => expect(win.location.href).toBe("blob:proof1"));
      expect(api.getTfdAccountabilityUrl).toHaveBeenCalledWith("c1");
      expect(api.fetchTfdAccountabilityFile).toHaveBeenCalledWith("/tfd/files/tok1");
      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(screen.queryByText(/comprovante-2026-11-02/)).toBeNull();
    });

    it("410 link_expired e 404 viram frase na tela e fecham a janela; pop-up bloqueado avisa", async () => {
      as();
      const win = fakeWindow();
      const open = vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
      vi.mocked(api.getTfdAccountabilityUrl).mockResolvedValue("/tfd/files/tok1");
      vi.mocked(api.fetchTfdAccountabilityFile).mockRejectedValueOnce(refusal(410, { error: "link_expired" }))
        .mockRejectedValueOnce(refusal(404, { error: "not_found" }));
      renderWithProviders(<AccountabilityForm tfdCase={done} onDone={() => {}} />);
      fireEvent.click(await screen.findByRole("button", { name: "Abrir o comprovante" }));
      expect(await screen.findByText("o link do comprovante expirou — abra de novo")).not.toBeNull();
      expect(win.close).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Abrir o comprovante" }));
      expect(await screen.findByText("o comprovante não está disponível — feche e abra o processo de novo")).not.toBeNull();
      open.mockReturnValue(null);
      fireEvent.click(screen.getByRole("button", { name: "Abrir o comprovante" }));
      expect(await screen.findByText("o navegador bloqueou a janela nova — permita janelas deste site para ver o comprovante")).not.toBeNull();
      expect(api.getTfdAccountabilityUrl).toHaveBeenCalledTimes(2);
    });

    it("o cliente busca o arquivo pelo endereço curto e devolve o blob", async () => {
      const real = await vi.importActual<typeof api>("../../lib/api");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("%PDF", { status: 200, headers: { "Content-Type": "application/pdf" } }));
      const file = await real.fetchTfdAccountabilityFile("/tfd/files/tok1");
      expect(fetchSpy.mock.calls[0][0]).toBe("/tfd/files/tok1");
      expect(file.blob.size).toBe(4);
      expect((fetchSpy.mock.calls[0][1] as RequestInit).credentials).toBe("include");
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: "link_expired" }), { status: 410 }));
      await expect(real.fetchTfdAccountabilityFile("/tfd/files/tok1")).rejects.toMatchObject({ status: 410 });
    });
  });
});

describe("na comissão", () => {
  it("processo em viagem mostra trechos, ajuda, pagamentos e prestação; autorizado não tem prestação", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(trUser([ "tfd_committee" ]));
    vi.mocked(api.listTfdCases).mockResolvedValue({ items: [ tfdRow() ], next_before: null });
    vi.mocked(api.readTfdCase).mockResolvedValueOnce(tfdCase({ status: "travelling" })).mockResolvedValueOnce(authorized);
    renderWithProviders(<TfdQueue today={TODAY30} now={NOW30} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ler o laudo de Maria da Silva" }));
    for (const name of [ "Trechos", "Ajuda de custo", "Pagamentos", "Prestação de contas" ]) {
      expect(await screen.findByRole("region", { name })).not.toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "Fechar laudo" }));
    fireEvent.click(screen.getByRole("button", { name: "Ler o laudo de Maria da Silva" }));
    expect(await screen.findByRole("region", { name: "Trechos" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Prestação de contas" })).toBeNull();
    expect(screen.getByRole("button", { name: "Novo trecho" })).not.toBeNull();
  });
});
