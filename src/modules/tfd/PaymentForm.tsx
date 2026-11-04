// Pagamento registrado do TFD (módulo 30, F-30.6). O api só aceita com o processo `scheduled`/`travelling`, pede segundo fator e
// não deixa apagar nem editar; o número do recibo é único no processo (409 `receipt_taken`). A tela confere tudo antes (data entre
// 365 dias atrás e hoje, valor com milhar e duas casas, forma, recibo 1–40) e só então abre a confirmação com o código.
import { useId, useState, type FormEvent } from "react";
import { recordTfdPayment, type TfdCase, type TfdPayment } from "../../lib/api";
import { paymentBody, paymentMethodLabel, paymentProblems, type PaymentDraft } from "../../lib/tfd";
import { fmtCents, fmtIsoDay } from "../../lib/transport";
import type { Problem } from "../../lib/pharmacy";
import { DataTable, type Column } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";
import { useTfdRefusalText } from "./stepUpText";

export const PAYMENT_IMMUTABLE = "O pagamento registrado não se apaga nem se edita.";
const PAYMENT_STATUSES = [ "scheduled", "travelling" ];
const METHODS = [ "cash", "transfer", "pix", "check" ];

const cols: Column<TfdPayment>[] = [
  { label: "Pago em", w: "0.8fr", card: "title", render: (p) => fmtIsoDay(p.paid_on) },
  { label: "Valor", w: "0.8fr", align: "right", render: (p) => fmtCents(p.amount_cents) },
  { label: "Forma", w: "0.8fr", render: (p) => paymentMethodLabel(p.method) },
  { label: "Recibo", w: "0.8fr", render: (p) => p.receipt_number },
  { label: "Registrado por", w: "1fr", render: (p) => p.by_name }
];

export function PaymentForm({ tfdCase: c, today, onSaved, onGoToSecurity }: {
  tfdCase: TfdCase; today: string; onSaved(c: TfdCase): void; onGoToSecurity?(): void;
}) {
  const refusalText = useTfdRefusalText();
  const ids = useId();
  const empty = (): PaymentDraft => ({ paidOn: today, amount: "", method: "", receiptNumber: "" });
  const [ d, setD ] = useState<PaymentDraft>(empty);
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ pending, setPending ] = useState<PaymentDraft | null>(null);
  const open = PAYMENT_STATUSES.includes(c.status);

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = paymentProblems(d, today);
    setProblems(found);
    setPending(found.length > 0 ? null : d);
  }

  const edit = (key: keyof PaymentDraft) => (e: { target: { value: string } }) => {
    setD((prev) => ({ ...prev, [key]: e.target.value }));
    setPending(null);
  };
  const problemAt = (path: string) => problems.find((p) => p.path === path)?.text;
  const field = (path: string) => {
    const text = problemAt(path);
    return text ? <p role="alert" style={alert}>{text}</p> : null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <DataTable<TfdPayment> cols={cols} rows={c.payments} rowKey={(p) => p.id} empty="nenhum pagamento registrado" />
      <p style={muted}>{PAYMENT_IMMUTABLE}</p>
      {!open ? <p style={muted}>o pagamento se registra com o processo agendado ou em viagem</p> : (
        <>
          <form aria-label="Pagamento registrado" onSubmit={submit} style={form} noValidate>
            <label style={fieldLabel} htmlFor={`${ids}-on`}>Pago em</label>
            <input id={`${ids}-on`} type="date" value={d.paidOn} max={today} disabled={pending !== null} style={inputStyle}
              aria-invalid={problemAt("paid_on") ? true : undefined} onChange={edit("paidOn")} />
            {field("paid_on")}
            <label style={fieldLabel} htmlFor={`${ids}-amount`}>Valor</label>
            <input id={`${ids}-amount`} inputMode="decimal" placeholder="0,00" value={d.amount} disabled={pending !== null} style={inputStyle}
              aria-invalid={problemAt("amount_cents") ? true : undefined} onChange={edit("amount")} />
            {field("amount_cents")}
            <label style={fieldLabel} htmlFor={`${ids}-method`}>Forma</label>
            <select id={`${ids}-method`} value={d.method} disabled={pending !== null} style={inputStyle}
              aria-invalid={problemAt("method") ? true : undefined} onChange={edit("method")}>
              <option value="">escolha a forma</option>
              {METHODS.map((m) => <option key={m} value={m}>{paymentMethodLabel(m)}</option>)}
            </select>
            {field("method")}
            <label style={fieldLabel} htmlFor={`${ids}-receipt`}>Número do recibo</label>
            <input id={`${ids}-receipt`} value={d.receiptNumber} maxLength={40} disabled={pending !== null} style={inputStyle}
              aria-invalid={problemAt("receipt_number") ? true : undefined} onChange={edit("receiptNumber")} />
            {field("receipt_number")}
            {!pending && <div style={row}><button type="submit" style={buttonStyle}>Registrar pagamento</button></div>}
          </form>
          {pending && (
            <SensitiveAction title="Confirmar pagamento" requiresStepUp onGoToSecurity={onGoToSecurity}
              description={`${fmtCents(paymentBody(pending).amount_cents)} em ${paymentMethodLabel(pending.method)}, recibo ${pending.receiptNumber.trim()}, pago em ${fmtIsoDay(pending.paidOn)}. ${PAYMENT_IMMUTABLE}`}
              translateError={refusalText}
              run={async () => {
                const next = await recordTfdPayment(c.id, paymentBody(pending));
                setD(empty());
                onSaved(next);
              }}
              onDone={() => setPending(null)} onCancel={() => setPending(null)} />
          )}
        </>
      )}
    </div>
  );
}
