import React, { useState } from 'react';
import { useVSCodeMessages } from './hooks/useVSCodeMessages';
import { ModelSelector } from './components/ModelSelector';
import { ChatPanel } from './components/ChatPanel';
import { ConversationHistory } from './components/ConversationHistory';

type View = 'history' | 'new' | 'chat';

export function App(): React.ReactElement {
  const {
    sessionId,
    conversationId,
    participants,
    messages,
    isStreaming,
    availableModels,
    modelsLoaded,
    error,
    pendingApprovals,
    viewMode,
    mascotUri,
    conversations,
    attachments,
    createSession,
    sendMessage,
    cancelAll,
    requestModels,
    resolveApproval,
    resetSession,
    listConversations,
    loadConversation,
    deleteConversation,
    requestFilePicker,
    attachActiveFile,
    removeAttachment,
    openInTab,
    sendIdeAction,
    attachByUri,
    attachSelection,
    pasteImage,
    ideActionResult,
    clearIdeActionResult,
  } = useVSCodeMessages();

  const [forceView, setForceView] = useState<'new' | null>(null);

  const currentView: View = sessionId
    ? 'chat'
    : forceView === 'new'
      ? 'new'
      : 'history';

  const handleNewChat = (): void => {
    setForceView('new');
  };

  const handleBackToHistory = (): void => {
    setForceView(null);
  };

  const handleCreateSession = (
    models: Array<{ providerId: string; modelId: string; displayName: string }>,
    chatMode: string
  ): void => {
    setForceView(null);
    createSession(models, chatMode);
  };

  const handleLoadConversation = (id: string): void => {
    setForceView(null);
    loadConversation(id);
  };

  if (currentView === 'history') {
    return (
      <ConversationHistory
        conversations={conversations}
        mascotUri={mascotUri}
        onNewChat={handleNewChat}
        onLoadConversation={handleLoadConversation}
        onDeleteConversation={deleteConversation}
        onRefresh={listConversations}
      />
    );
  }

  if (currentView === 'new') {
    return (
      <ModelSelector
        availableModels={availableModels}
        modelsLoaded={modelsLoaded}
        error={error}
        mascotUri={mascotUri}
        onCreateSession={handleCreateSession}
        onRequestModels={requestModels}
        onBack={handleBackToHistory}
      />
    );
  }

  return (
    <ChatPanel
      messages={messages}
      participants={participants}
      isStreaming={isStreaming}
      error={error}
      pendingApprovals={pendingApprovals}
      attachments={attachments}
      mascotUri={mascotUri}
      viewMode={viewMode}
      onSend={sendMessage}
      onCancel={cancelAll}
      onResolveApproval={resolveApproval}
      onResetSession={resetSession}
      onRequestFilePicker={requestFilePicker}
      onAttachActiveFile={attachActiveFile}
      onRemoveAttachment={removeAttachment}
      onOpenInTab={openInTab}
      ideActionResult={ideActionResult}
      onIdeAction={sendIdeAction}
      onClearIdeResult={clearIdeActionResult}
      onAttachByUri={attachByUri}
      onAttachSelection={attachSelection}
      onPasteImage={pasteImage}
    />
  );
}
