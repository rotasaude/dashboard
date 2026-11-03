// A caderneta aberta na sala (módulo 29; F-29.2; contrato §2, §5; spec decisão 3a). O api calcula situação, aprazamento e atraso;
// a tela só agrupa. Sem conferência (`checked: null`) a palavra "atraso" não existe: o item `overdue` vira "não conferida"
// (effectiveStatus), o bloco "Em atraso" dá lugar a "Não conferidas" e o aviso oferece as duas saídas. "Confirmar caderneta
// completa" é em dois passos e devolve a caderneta conferida (POST …/checks). O foco vai ao nome quando a caderneta abre.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { confirmCardComplete, type CardItem, type Immunization, type VaccinationCard, type VaccinationCatalog, type VaccineLocation } from "../../lib/api";
import { fmtDateTime, cityIsoDate } from "../../lib/format";
import {
  UNCHECKED_NOTICE, cardGroups, cardItemStatusLabel, cardStatusTone, checkModeLabel, effectiveStatus, vaccinationError
} from "../../lib/vaccination";
import { fmtDay } from "../../lib/exams";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, list, muted, panel, row, stack, title } from "../exams/styles";
import { ImmunizationRow } from "./ImmunizationRow";

export interface CardViewProps {
  room: VaccineLocation; card: VaccinationCard; catalog: VaccinationCatalog; now: Date;
  onCard(c: VaccinationCard): void; onRecord(item: CardItem | null): void; onTranscribe(): void; onGoToSecurity?(): void;
  onCancelDose?(imm: Immunization): void;
}

export function CardView({ room, card, catalog, now, onCard, onRecord, onTranscribe, onGoToSecurity, onCancelDose }: CardViewProps) {
  const today = cityIsoDate(now);
  const p = card.patient;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [ p.id ]);

  const [ confirming, setConfirming ] = useState(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  // Callbacks no mutate(), não nas opções: no TanStack v5 os das opções disparam mesmo depois de desmontar (outra pessoa aberta).
  // A tela de cima ainda confere o paciente da resposta (onCard).
  const confirm = useMutation({ gcTime: 0, mutationFn: (patientId: string) => confirmCardComplete(room.room_id as string, patientId) });
  function sendConfirm() {
    if (confirm.isPending) return;
    setProblem(null);
    confirm.mutate(p.id, {
      onSuccess: (c) => { setConfirming(false); onCard(c); },
      onError: (err) => setProblem(vaccinationError(err))
    });
  }

  const groups = cardGroups(card);
  const vaccineName = (item: CardItem) =>
    item.immunobiological.name ?? catalog.immunobiologicals.find((i) => i.code === item.immunobiological.code)?.name ?? item.immunobiological.code;
  const doseName = (item: CardItem) => item.dose.name ?? item.dose.code;
  const statusCol: Column<CardItem> = {
    label: "Situação", w: "1.4fr",
    render: (item) => {
      const status = effectiveStatus(item, card.checked);
      return <Tag tone={cardStatusTone(status)}>{cardItemStatusLabel(item, status, today)}</Tag>;
    }
  };
  const base: Column<CardItem>[] = [
    { label: "Vacina", w: "2fr", card: "title", render: vaccineName },
    { label: "Dose", w: "1fr", render: doseName },
    { label: "Data", w: "1fr", render: (item) => fmtDay(item.due_on) },
    statusCol
  ];
  const withAction: Column<CardItem>[] = [
    ...base,
    { label: "Ação", w: "1.6fr", card: "actions", render: (item) => (
      <button type="button" style={secondaryButtonStyle} onClick={() => onRecord(item)}>
        {`Registrar ${vaccineName(item)} — ${doseName(item)}`}
      </button>
    ) }
  ];
  const applied: Column<CardItem>[] = [
    { label: "Vacina", w: "2fr", card: "title", render: vaccineName },
    { label: "Dose", w: "1fr", render: doseName },
    { label: "Aplicada em", w: "1.4fr", render: (item) => item.applied ? fmtDateTime(item.applied.applied_at) : "—" },
    { label: "Origem", w: "1fr", render: (item) => item.applied?.transcription ? <Tag tone="info">transcrição</Tag> : "sala" }
  ];
  const key = (item: CardItem, i: number) => `${item.immunobiological.code}-${item.dose.code}-${i}`;
  const block = (label: string, cols: Column<CardItem>[], rows: CardItem[], empty: string) => (
    <section aria-label={label} style={panel}>
      <h3 style={title}>{label}</h3>
      <DataTable cols={cols} rows={rows} rowKey={key} empty={empty} />
    </section>
  );

  const identity = p.has_cpf ? "com CPF" : p.cns_masked ? `CNS ${p.cns_masked}` : "sem CPF nem CNS";
  return (
    <div style={stack}>
      <section aria-label="Pessoa" style={panel}>
        <h2 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 18 }}>{p.display_name ?? "pessoa sem nome no cadastro"}</h2>
        <div style={row}>
          <span style={muted}>{`nascido em ${fmtDay(p.birth_date)}`}</span>
          <span style={muted}>{identity}</span>
          {card.checked
            ? <Tag tone="ok">{checkModeLabel(card.checked.mode)}</Tag>
            : <Tag tone="warn">não conferida</Tag>}
        </div>
        {!card.checked && <p role="note" style={{ margin: 0, fontSize: 12.5 }}>{UNCHECKED_NOTICE}</p>}
        <div style={row}>
          {/* A transcrição vale em qualquer caderneta (o api aceita); fechar a conferência só é oferecido sem conferência (TranscriptionForm). */}
          <button type="button" style={secondaryButtonStyle} onClick={onTranscribe}>Transcrever caderneta</button>
          {!card.checked && (confirming ? (
            <>
              <button type="button" style={confirm.isPending ? disabledButtonStyle : buttonStyle} disabled={confirm.isPending} onClick={sendConfirm}>
                Sim, a caderneta está completa
              </button>
              <button type="button" style={secondaryButtonStyle} disabled={confirm.isPending} onClick={() => setConfirming(false)}>Voltar</button>
            </>
          ) : (
            <button type="button" style={buttonStyle} onClick={() => { setProblem(null); setConfirming(true); }}>Confirmar caderneta completa</button>
          ))}
        </div>
        {problem && <p role="alert" style={alert}>{problem}</p>}
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} onClick={() => onRecord(null)}>Outra vacina</button>
        </div>
      </section>
      {block("Devidas hoje", withAction, groups.today, "nenhuma vacina devida hoje")}
      {card.checked
        ? block("Em atraso", withAction, groups.overdue, "nenhuma vacina pendente de dias anteriores")
        : block("Não conferidas", base, groups.unchecked, "nenhuma")}
      {block("Próximas", base, groups.upcoming, "nenhuma próxima dose no calendário")}
      {block("Aplicadas", applied, groups.done, "nenhuma dose aplicada no calendário")}
      <section aria-label="Doses registradas" style={panel}>
        <h3 style={title}>Doses registradas</h3>
        {card.immunizations.length === 0 ? <p style={muted}>nenhuma dose registrada</p> : (
          <ul style={{ ...list, paddingLeft: 0, gap: 8 }}>
            {card.immunizations.map((imm) => (
              <ImmunizationRow key={imm.id} imm={imm} onGoToSecurity={onGoToSecurity} onChanged={() => undefined} onCancelDose={onCancelDose} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
