/**
 * Shared message attribution logic for workers.
 *
 * Both LangChainWorker and ProviderAdapterWorker use the same attribution rules:
 * - User messages → role: 'user'
 * - THIS agent's own prior responses → role: 'assistant'
 * - OTHER agents' responses → role: 'user' with [AgentName] prefix
 *
 * We CANNOT use role: 'assistant' for other agents' responses because
 * models ignore the `name` field and treat ALL assistant messages as their own
 * prior output, causing them to copy/repeat other models' answers verbatim.
 */

export interface AttributedMessage {
  role: 'user' | 'assistant';
  content: string;
  name?: string | undefined;
}

/** Build conversation history with proper agent attribution. */
export function buildAttributedHistory(
  myName: string,
  conversationHistory: ReadonlyArray<{ role: string; content: string; name?: string | undefined }>,
): AttributedMessage[] {
  return conversationHistory.map((h): AttributedMessage => {
    if (h.role === 'user') {
      return { role: 'user', content: h.content };
    }
    // This agent's own prior response
    if (h.name === myName) {
      return { role: 'assistant', content: h.content };
    }
    // Another agent's response — must be user role
    const senderLabel = h.name ?? 'Another model';
    return { role: 'user', content: `[${senderLabel}]: ${h.content}` };
  });
}
