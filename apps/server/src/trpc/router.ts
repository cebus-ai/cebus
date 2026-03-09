import { t } from './trpc';
import { workspaceRouter } from './routers/workspace';
import { channelRouter } from './routers/channel';
import { agentRouter } from './routers/agent';
import { messageRouter } from './routers/message';
import { streamRouter } from './routers/stream';
import { taskRouter } from './routers/task';
import { inboxRouter } from './routers/inbox';
import { branchRouter } from './routers/branch';
import { roleRouter } from './routers/role';
import { debugRouter } from './routers/debug';

export const appRouter = t.router({
  workspace: workspaceRouter,
  channel: channelRouter,
  agent: agentRouter,
  message: messageRouter,
  stream: streamRouter,
  task: taskRouter,
  inbox: inboxRouter,
  branch: branchRouter,
  role: roleRouter,
  debug: debugRouter,
});

export type AppRouter = typeof appRouter;
