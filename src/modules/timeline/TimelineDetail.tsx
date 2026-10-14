// src/modules/timeline/TimelineDetail.tsx
// O detalhe de uma entrada da linha do tempo, nas telas que já existem
// (módulo 20; spec §8): consulta (19a), documento (19c/19d), escuta (18) e
// pedido de agendamento (08/17). Cada uma lê pelo próprio caminho do api, que
// confere de novo quem lê e grava a trilha.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConsultationOptions, type Addendum, type PatientProblem } from "../../lib/api";
import { OPTIONS_KEY } from "../../lib/consultation";
import type { DetailTarget } from "../../lib/timeline";
import { useAuth } from "../../lib/auth";
import { ConsultationLoader } from "../consultation/ConsultationView";
import { ScreeningDetailLoader } from "../attendance/ScreeningDetail";
import { RequestDetailPanel } from "../attendance/RequestDetailPanel";
import { ExamOrderDetail } from "../exams/ExamOrderDetail";
import { DocumentDetail } from "./DocumentDetail";

interface Props {
  target: DetailTarget;
  onClose(): void;
  endOnOutOfContext?: boolean;
  onOpeningRequired?(): void;
  searchDelayMs?: number;
  // Consulta: os problemas do paciente (para o adendo) e o aviso do adendo a quem abriu.
  patientProblems?: PatientProblem[];
  onAddendumAdded?(addendum: Addendum): void;
}

export function TimelineDetail({
  target, onClose, endOnOutOfContext, onOpeningRequired, searchDelayMs, patientProblems = [], onAddendumAdded
}: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Escuta e pedido são telas antigas sem gcTime: 0; o que foi aberto daqui
  // (dado de saúde) sai do cache quando o detalhe fecha ou troca.
  const { type, id } = target;
  useEffect(() => () => {
    if (type === "screening") queryClient.removeQueries({ queryKey: [ "screening", id ], exact: true });
    if (type === "appointment_request") queryClient.removeQueries({ queryKey: [ "requestDetail", id ], exact: true });
  }, [ type, id, queryClient ]);
  const options = useQuery({
    queryKey: [ OPTIONS_KEY, user?.id ?? null ], queryFn: getConsultationOptions, staleTime: 5 * 60_000,
    enabled: target.type === "consultation"
  });

  switch (target.type) {
    case "consultation":
      return (
        <ConsultationLoader id={target.id} options={options.data ?? null} patientProblems={patientProblems} searchDelayMs={searchDelayMs}
          endOnOutOfContext={endOnOutOfContext} onOpeningRequired={onOpeningRequired} onClose={onClose}
          onAddendumAdded={onAddendumAdded} />
      );
    case "clinical_document":
      return <DocumentDetail id={target.id} onClose={onClose} endOnOutOfContext={endOnOutOfContext} onOpeningRequired={onOpeningRequired} />;
    case "screening":
      return <ScreeningDetailLoader id={target.id} onClose={onClose} />;
    case "appointment_request":
      return <RequestDetailPanel requestId={target.id} onClose={onClose} />;
    case "exam_order":
      return <ExamOrderDetail id={target.id} onClose={onClose} />;
  }
}
