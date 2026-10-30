// CEO e lista do TSB/ASB (módulo 28). Tela-portão: o corpo vem nas Tasks 10–12.
import { EmptyState } from "../components/EmptyState";
import { DentalGate } from "./dental/DentalGate";

export function DentalAdmin(_props: { onGoToSecurity?(): void } = {}) {
  return (
    <DentalGate title="CEO e lista do TSB/ASB" sub="tipo e especialidades do CEO; o que TSB e ASB registram" allow={(r) => r.admin}>
      {() => <EmptyState title="Em construção nesta branch." />}
    </DentalGate>
  );
}
