// ErrorState — mensagem + retry. Usado por todo painel (estado obrigatório).

interface Props {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: Props) {
  return (
    <div
      style={{
        padding: "20px 16px",
        border: "1px dashed var(--rule2)",
        borderRadius: 8,
        background: "var(--down-bg)",
        color: "var(--down)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-start"
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>Falha ao carregar</div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink2)" }}>
        {message}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mono"
          style={{
            marginTop: 4,
            padding: "4px 10px",
            border: "1px solid var(--rule2)",
            borderRadius: 6,
            background: "var(--panel)",
            fontSize: 11,
            color: "var(--ink)"
          }}
        >
          tentar novamente
        </button>
      )}
    </div>
  );
}
