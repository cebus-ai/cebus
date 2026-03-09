import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

type Locale = 'en' | 'he';

const translations = {
  en: {
    // Sidebar
    'brand.title': 'Agentic OS — Cebus',
    'brand.subtitle': 'Multi-Agent Workspace',
    'sidebar.channels': 'Channels',
    'sidebar.agents': 'All Agents',
    'sidebar.noAgents': 'No agents configured — click + above',
    'sidebar.signOut': 'Sign out',

    // Chat
    'chat.selectChannel': 'Select a channel to start chatting',
    'chat.noMessages': 'No messages yet',
    'chat.startConversation': 'Start the conversation!',
    'chat.settings': 'Channel settings',
    'chat.clearChat': 'Clear chat',
    'chat.agent': 'agent',
    'chat.agents': 'agents',
    'chat.member': 'member',
    'chat.members': 'members',
    'chat.thinking': 'Thinking...',
    'chat.reasoning': 'Reasoning...',
    'chat.writing': 'Writing...',
    'chat.messagePlaceholder': 'Message the group... @ to mention',
    'chat.selectChannelPlaceholder': 'Select a channel...',
    'chat.you': 'You',
    'chat.ai': 'AI',
    'chat.orchestrator': 'Team Leader',
    'chat.editing': 'Editing',
    'chat.saveAndResend': 'Save & Resend',
    'chat.cancel': 'Cancel',
    'chat.toCancel': 'to cancel',
    'chat.toSend': 'to send',
    'chat.to': 'To:',
    'chat.orchestratorDecides': 'Team Leader decides',
    'chat.tagMention': 'Type @ to mention',
    'chat.stopGeneration': 'Stop',
    'chat.escToStop': 'Esc to stop',
    'chat.askingUser': 'is asking you',

    // Response length
    'response.label': 'Response:',
    'response.free': 'Free',
    'response.short': 'Short',
    'response.medium': 'Medium',
    'response.detailed': 'Detailed',

    // Channel settings
    'settings.title': 'Channel Settings',
    'settings.name': 'Name',
    'settings.subject': 'Subject',
    'settings.instructions': 'Instructions',
    'settings.chatMode': 'Chat Mode',
    'settings.orchestrator': 'Enable Team Leader',
    'settings.orchestratorDesc': 'AI team leader that analyzes messages, selects agents, and coordinates multi-round discussions.',
    'settings.orchestratorModel': 'Team Leader Model',
    'settings.archive': 'Archive',
    'settings.delete': 'Delete',
    'settings.save': 'Save',
    'settings.saving': 'Saving...',
    'settings.selectProvider': 'Select provider',
    'settings.selectModel': 'Select model',
    'settings.workspaceDefaults': 'Workspace Defaults',
    'settings.defaultContextWindow': 'Default Context Window',
    'settings.defaultContextWindowDesc': 'Number of recent messages sent to AI models when creating new channels.',

    // Channel actions
    'channel.archive': 'Archive channel',
    'channel.delete': 'Delete channel',
    'channel.noChannels': 'No channels yet',

    // Create channel
    'create.title': 'Create Channel',
    'create.channelName': 'Channel Name',
    'create.cancel': 'Cancel',
    'create.create': 'Create',
    'create.creating': 'Creating...',

    // Right panel
    'panel.inbox': 'Inbox',
    'panel.canvas': 'Canvas',

    // Direction
    'dir.toggle': 'EN',

    // Panels
    'panel.hideLeft': 'Hide sidebar',
    'panel.showLeft': 'Show sidebar',
    'panel.hideRight': 'Hide right panel',
    'panel.showRight': 'Show right panel',

    // Add agent
    'addAgent.title': 'Add Agent',
    'addAgent.provider': 'Provider',
    'addAgent.model': 'Model',
    'addAgent.displayName': 'Display Name',
    'addAgent.loading': 'Loading providers...',
    'addAgent.noModels': 'No models available for this provider',
    'addAgent.submit': 'Add Agent',
    'addAgent.adding': 'Creating...',
    'addAgent.addToChannel': 'Add to channel',
    'addAgent.deleteAgent': 'Delete agent',
    'addAgent.noRole': 'No role (default)',

    // Agent list
    'agentList.selectProvider': 'Select provider',
    'agentList.selectModel': 'Select model',

    // Chat modes
    'mode.freeChat': 'Free Chat',
    'mode.freeChatDesc': 'All agents respond simultaneously',
    'mode.sequential': 'Sequential',
    'mode.sequentialDesc': 'Agents take turns one by one',
    'mode.tagOnly': 'Tag Only',
    'mode.tagOnlyDesc': 'Agents respond only when @mentioned',
    'mode.roleBased': 'Role Based',
    'mode.roleBasedDesc': 'Agents respond based on assigned roles',
    'mode.raw': 'Raw',
    'mode.rawDesc': 'No rules — models only know they are in a group chat',

    // Create channel extra
    'create.subject': 'Subject (optional)',

    // Theme
    'theme.light': 'Switch to light mode',
    'theme.dark': 'Switch to dark mode',

    // Roles
    'roles.title': 'Manage Roles',
    'roles.builtIn': 'Built-in',
    'roles.custom': 'Custom',
    'roles.createNew': 'Create New Role',
    'roles.editRole': 'Edit Role',
    'roles.deleteRole': 'Delete',
    'roles.name': 'Name',
    'roles.description': 'Description (optional)',
    'roles.instructions': 'Instructions',
    'roles.instructionsHint': 'System prompt that defines this role\'s behavior',
    'roles.generateAI': 'Generate with AI',
    'roles.generating': 'Generating...',
    'roles.selectModel': 'Select a model to generate',
    'roles.save': 'Save Role',
    'roles.saving': 'Saving...',
    'roles.cancel': 'Cancel',
    'roles.manageRoles': 'Manage Roles',
    'roles.noCustomRoles': 'No custom roles yet',
    'roles.empty': 'No roles available',

    // Context
    'context.boundary': 'AI context starts here — older messages are not sent to models',
    'context.showHistory': 'Show earlier messages',

    // Threads
    'thread.title': 'Thread',
    'thread.reply': 'reply',
    'thread.replies': 'replies',
    'thread.replyPlaceholder': 'Reply in thread... @tag to mention a model',
    'thread.replyCount': '{count} replies',
    'thread.openThread': 'Open thread',

    // Agent Editor
    'agentEditor.title': 'Edit Agent',
    'agentEditor.displayName': 'Display Name',
    'agentEditor.displayNameHint': 'Override name for this channel only',
    'agentEditor.role': 'Role',
    'agentEditor.noRole': 'No role',
    'agentEditor.customInstructions': 'Custom Instructions',
    'agentEditor.customInstructionsHint': 'Per-channel instructions for this agent',
    'agentEditor.save': 'Save',
    'agentEditor.saving': 'Saving...',
    'agentEditor.remove': 'Remove from channel',

    'permissions.folderAccess': 'Folder Access',
    'permissions.folderAccessDesc': 'Allow agents to read files and run commands in the project',
    'permissions.wantsTo': 'wants to',
    'permissions.shell': 'run a shell command',
    'permissions.write': 'write a file',
    'permissions.read': 'read a file',
    'permissions.mcp': 'use an MCP tool',
    'permissions.url': 'fetch a URL',
    'permissions.allowOnce': 'Allow once',
    'permissions.allowSession': 'Allow for session',
    'permissions.deny': 'Deny',

    // Auth
    'auth.signIn': 'Sign In',
    'auth.createAccount': 'Create Account',
    'auth.username': 'Username',
    'auth.password': 'Password',
    'auth.displayName': 'Display Name (optional)',
    'auth.noAccount': 'No account?',
    'auth.haveAccount': 'Have an account?',
    'auth.signUp': 'Sign up',
    'auth.signInLink': 'Sign in',

    // Inbox
    'inbox.noDMs': 'No DM conversations yet',
    'inbox.allRead': 'All read',
    'inbox.unread': 'unread',
    'inbox.clearAll': 'Clear All',

    // Orchestrator status
    'orchestrator.idle': 'Idle',
    'orchestrator.analyzing': 'Analyzing',
    'orchestrator.planning': 'Planning',
    'orchestrator.executing': 'Executing',
    'orchestrator.reviewing': 'Reviewing',
    'orchestrator.complete': 'Complete',
    'orchestrator.done': 'Done',
    'orchestrator.now': 'Now',
    'orchestrator.enabled': 'Team Leader enabled',
    'orchestrator.dispatching': 'Dispatching tasks',
    'orchestrator.parallel': 'parallel',
    'orchestrator.guidance': 'Team Leader guidance',
    'orchestrator.synthesis': 'Team Leader synthesis',

    // Plan card
    'plan.title': 'Execution Plan',
    'plan.rounds': 'rounds',
    'plan.cost': 'cost',
    'plan.approve': 'Approve',
    'plan.reject': 'Reject',
    'plan.approved': 'Approved',
    'plan.rejected': 'Rejected',

    // User input form
    'userInput.backToOptions': 'Back to options',
    'userInput.otherOption': 'Other (type your own)...',
    'userInput.placeholder': 'Type your answer...',
    'userInput.send': 'Send',

    // Debug panel
    'debug.title': 'Debug Logs',
    'debug.notEnabled': 'Debug mode is not enabled.',
    'debug.enableHint': 'to enable.',
    'debug.currentChannel': 'Current Channel',
    'debug.noSessions': 'No debug sessions yet. Send a message to start logging.',
    'debug.noFiles': 'No debug files yet.',
    'debug.loading': 'Loading...',
    'debug.refresh': 'Refresh',
    'debug.back': 'Back',
    'debug.tab': 'Debug',
    'debug.files': 'files',
    'debug.fileTeamLeader': 'Team Leader Decisions',
    'debug.fileTranscript': 'Chat Transcript',
    'debug.fileDebugLog': 'Debug Log',

    // Code blocks
    'code.copy': 'Copy',
    'code.copied': 'Copied',
  },
  he: {
    // Sidebar
    'brand.title': 'Agentic OS — Cebus',
    'brand.subtitle': 'סביבת עבודה רב-סוכנית',
    'sidebar.channels': 'ערוצים',
    'sidebar.agents': 'כל הסוכנים',
    'sidebar.noAgents': 'אין סוכנים מוגדרים — לחץ + למעלה',
    'sidebar.signOut': 'התנתק',

    // Chat
    'chat.selectChannel': 'בחר ערוץ כדי להתחיל לשוחח',
    'chat.noMessages': 'אין הודעות עדיין',
    'chat.startConversation': 'התחל את השיחה!',
    'chat.settings': 'הגדרות ערוץ',
    'chat.clearChat': 'נקה צ\'אט',
    'chat.agent': 'סוכן',
    'chat.agents': 'סוכנים',
    'chat.member': 'חבר',
    'chat.members': 'חברים',
    'chat.thinking': 'חושב...',
    'chat.reasoning': 'מנתח...',
    'chat.writing': 'כותב...',
    'chat.messagePlaceholder': 'הודעה לקבוצה... @ לתיוג',
    'chat.selectChannelPlaceholder': 'בחר ערוץ...',
    'chat.you': 'אתה',
    'chat.ai': 'AI',
    'chat.orchestrator': 'ראש צוות',
    'chat.editing': 'עריכה',
    'chat.saveAndResend': 'שמור ושלח מחדש',
    'chat.cancel': 'ביטול',
    'chat.toCancel': 'לביטול',
    'chat.toSend': 'לשליחה',
    'chat.to': 'אל:',
    'chat.orchestratorDecides': 'ראש הצוות מחליט',
    'chat.tagMention': 'הקלד @ לתיוג',
    'chat.stopGeneration': 'עצור',
    'chat.escToStop': 'Esc לעצירה',
    'chat.askingUser': 'שואל אותך',

    // Response length
    'response.label': 'תשובה:',
    'response.free': 'חופשי',
    'response.short': 'קצר',
    'response.medium': 'בינוני',
    'response.detailed': 'מפורט',

    // Channel settings
    'settings.title': 'הגדרות ערוץ',
    'settings.name': 'שם',
    'settings.subject': 'נושא',
    'settings.instructions': 'הוראות',
    'settings.chatMode': 'מצב צ\'אט',
    'settings.orchestrator': 'הפעל ראש צוות',
    'settings.orchestratorDesc': 'ראש צוות AI שמנתח הודעות, בוחר סוכנים ומתאם דיונים רב-סבביים.',
    'settings.orchestratorModel': 'מודל ראש צוות',
    'settings.archive': 'ארכיון',
    'settings.delete': 'מחק',
    'settings.save': 'שמור',
    'settings.saving': 'שומר...',
    'settings.selectProvider': 'בחר ספק',
    'settings.selectModel': 'בחר מודל',
    'settings.workspaceDefaults': 'ברירות מחדל של סביבת עבודה',
    'settings.defaultContextWindow': 'חלון הקשר ברירת מחדל',
    'settings.defaultContextWindowDesc': 'מספר ההודעות האחרונות שנשלחות למודלי AI בעת יצירת ערוצים חדשים.',

    // Channel actions
    'channel.archive': 'ארכב ערוץ',
    'channel.delete': 'מחק ערוץ',
    'channel.noChannels': 'אין ערוצים עדיין',

    // Create channel
    'create.title': 'צור ערוץ',
    'create.channelName': 'שם הערוץ',
    'create.cancel': 'ביטול',
    'create.create': 'צור',
    'create.creating': 'יוצר...',

    // Right panel
    'panel.inbox': 'דואר',
    'panel.canvas': 'קנבס',

    // Direction
    'dir.toggle': 'HE',

    // Panels
    'panel.hideLeft': 'הסתר סרגל צד',
    'panel.showLeft': 'הצג סרגל צד',
    'panel.hideRight': 'הסתר פאנל ימני',
    'panel.showRight': 'הצג פאנל ימני',

    // Add agent
    'addAgent.title': 'הוסף סוכן',
    'addAgent.provider': 'ספק',
    'addAgent.model': 'מודל',
    'addAgent.displayName': 'שם תצוגה',
    'addAgent.loading': 'טוען ספקים...',
    'addAgent.noModels': 'אין מודלים זמינים לספק זה',
    'addAgent.submit': 'הוסף סוכן',
    'addAgent.adding': 'יוצר...',
    'addAgent.addToChannel': 'הוסף לערוץ',
    'addAgent.deleteAgent': 'מחק סוכן',
    'addAgent.noRole': 'ללא תפקיד (ברירת מחדל)',

    // Agent list
    'agentList.selectProvider': 'בחר ספק',
    'agentList.selectModel': 'בחר מודל',

    // Chat modes
    'mode.freeChat': 'צ\'אט חופשי',
    'mode.freeChatDesc': 'כל הסוכנים מגיבים בו-זמנית',
    'mode.sequential': 'סדרתי',
    'mode.sequentialDesc': 'הסוכנים מגיבים בתור אחד אחרי השני',
    'mode.tagOnly': 'תיוג בלבד',
    'mode.tagOnlyDesc': 'הסוכנים מגיבים רק כשמתייגים אותם עם @',
    'mode.roleBased': 'מבוסס תפקיד',
    'mode.roleBasedDesc': 'הסוכנים מגיבים על פי תפקידם המוקצה',
    'mode.raw': 'גולמי',
    'mode.rawDesc': 'ללא כללים — המודלים יודעים רק שהם בצ\'אט קבוצתי',

    // Create channel extra
    'create.subject': 'נושא (אופציונלי)',

    // Theme
    'theme.light': 'עבור למצב בהיר',
    'theme.dark': 'עבור למצב כהה',

    // Roles
    'roles.title': 'ניהול תפקידים',
    'roles.builtIn': 'מובנה',
    'roles.custom': 'מותאם',
    'roles.createNew': 'צור תפקיד חדש',
    'roles.editRole': 'ערוך תפקיד',
    'roles.deleteRole': 'מחק',
    'roles.name': 'שם',
    'roles.description': 'תיאור (אופציונלי)',
    'roles.instructions': 'הוראות',
    'roles.instructionsHint': 'הנחיות מערכת שמגדירות את התנהגות התפקיד',
    'roles.generateAI': 'צור עם AI',
    'roles.generating': 'מייצר...',
    'roles.selectModel': 'בחר מודל ליצירה',
    'roles.save': 'שמור תפקיד',
    'roles.saving': 'שומר...',
    'roles.cancel': 'ביטול',
    'roles.manageRoles': 'ניהול תפקידים',
    'roles.noCustomRoles': 'אין תפקידים מותאמים עדיין',
    'roles.empty': 'אין תפקידים זמינים',

    // Context
    'context.boundary': 'הקשר AI מתחיל כאן — הודעות ישנות לא נשלחות למודלים',
    'context.showHistory': 'הצג הודעות קודמות',

    // Threads
    'thread.title': 'שרשור',
    'thread.reply': 'תגובה',
    'thread.replies': 'תגובות',
    'thread.replyPlaceholder': 'הגב בשרשור... @תייג כדי לציין מודל',
    'thread.replyCount': '{count} תגובות',
    'thread.openThread': 'פתח שרשור',

    // Agent Editor
    'agentEditor.title': 'עריכת סוכן',
    'agentEditor.displayName': 'שם תצוגה',
    'agentEditor.displayNameHint': 'שם מותאם לערוץ זה בלבד',
    'agentEditor.role': 'תפקיד',
    'agentEditor.noRole': 'ללא תפקיד',
    'agentEditor.customInstructions': 'הוראות מותאמות',
    'agentEditor.customInstructionsHint': 'הוראות ייחודיות לסוכן בערוץ זה',
    'agentEditor.save': 'שמור',
    'agentEditor.saving': 'שומר...',
    'agentEditor.remove': 'הסר מהערוץ',

    'permissions.folderAccess': 'גישה לתיקיה',
    'permissions.folderAccessDesc': 'אפשר לסוכנים לקרוא קבצים ולהריץ פקודות בפרויקט',
    'permissions.wantsTo': 'רוצה',
    'permissions.shell': 'להריץ פקודה',
    'permissions.write': 'לכתוב קובץ',
    'permissions.read': 'לקרוא קובץ',
    'permissions.mcp': 'להשתמש בכלי MCP',
    'permissions.url': 'לגשת לכתובת URL',
    'permissions.allowOnce': 'אפשר פעם אחת',
    'permissions.allowSession': 'אפשר לכל הסשן',
    'permissions.deny': 'דחה',

    // Auth
    'auth.signIn': 'התחברות',
    'auth.createAccount': 'יצירת חשבון',
    'auth.username': 'שם משתמש',
    'auth.password': 'סיסמה',
    'auth.displayName': 'שם תצוגה (אופציונלי)',
    'auth.noAccount': 'אין חשבון?',
    'auth.haveAccount': 'יש חשבון?',
    'auth.signUp': 'הרשמה',
    'auth.signInLink': 'התחברות',

    // Inbox
    'inbox.noDMs': 'אין שיחות DM עדיין',
    'inbox.allRead': 'הכל נקרא',
    'inbox.unread': 'לא נקרא',
    'inbox.clearAll': 'נקה הכל',

    // Orchestrator status
    'orchestrator.idle': 'ממתין',
    'orchestrator.analyzing': 'מנתח',
    'orchestrator.planning': 'מתכנן',
    'orchestrator.executing': 'מבצע',
    'orchestrator.reviewing': 'סוקר',
    'orchestrator.complete': 'הושלם',
    'orchestrator.done': 'בוצע',
    'orchestrator.now': 'עכשיו',
    'orchestrator.enabled': 'ראש צוות מופעל',
    'orchestrator.dispatching': 'הפצת משימות',
    'orchestrator.parallel': 'מקבילי',
    'orchestrator.guidance': 'הנחיית ראש צוות',
    'orchestrator.synthesis': 'סיכום ראש צוות',

    // Plan card
    'plan.title': 'תוכנית ביצוע',
    'plan.rounds': 'סבבים',
    'plan.cost': 'עלות',
    'plan.approve': 'אשר',
    'plan.reject': 'דחה',
    'plan.approved': 'אושר',
    'plan.rejected': 'נדחה',

    // User input form
    'userInput.backToOptions': 'חזרה לאפשרויות',
    'userInput.otherOption': 'אחר (הקלד בעצמך)...',
    'userInput.placeholder': 'הקלד את תשובתך...',
    'userInput.send': 'שלח',

    // Debug panel
    'debug.title': 'לוגים לניפוי',
    'debug.notEnabled': 'מצב ניפוי אינו מופעל.',
    'debug.enableHint': 'להפעלה.',
    'debug.currentChannel': 'ערוץ נוכחי',
    'debug.noSessions': 'אין סשנים לניפוי עדיין. שלח הודעה כדי להתחיל.',
    'debug.noFiles': 'אין קבצי ניפוי עדיין.',
    'debug.loading': 'טוען...',
    'debug.refresh': 'רענן',
    'debug.back': 'חזרה',
    'debug.tab': 'ניפוי',
    'debug.files': 'קבצים',
    'debug.fileTeamLeader': 'החלטות ראש צוות',
    'debug.fileTranscript': 'תמלול שיחה',
    'debug.fileDebugLog': 'לוג ניפוי',

    // Code blocks
    'code.copy': 'העתק',
    'code.copied': 'הועתק',
  },
} as const;

type TranslationKey = keyof typeof translations.en;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en';
    return (localStorage.getItem('locale') as Locale) ?? 'en';
  });

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('locale', newLocale);
    localStorage.setItem('dir', newLocale === 'he' ? 'rtl' : 'ltr');
  };

  useEffect(() => {
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (key: TranslationKey): string => {
    return translations[locale][key] ?? translations.en[key] ?? key;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, isRtl: locale === 'he' }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
