interface StreamingIndicatorProps {
  agentName: string;
}

export function StreamingIndicator({ agentName }: StreamingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-500">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
      </div>
      <span>{agentName} is typing...</span>
    </div>
  );
}
