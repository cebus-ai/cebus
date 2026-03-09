import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { protectedProcedure } from '../middleware';
import { listDebugScopes, listDebugFiles, readDebugFile, isDebugEnabled } from '@cebus/engine';

export const debugRouter = t.router({
  isEnabled: protectedProcedure.query(() => isDebugEnabled()),

  listScopes: protectedProcedure.query(() => {
    if (!isDebugEnabled()) return [];
    return listDebugScopes();
  }),

  listFiles: protectedProcedure
    .input(z.object({
      type: z.enum(['channel', 'dm']),
      id: z.string().min(1),
    }))
    .query(({ input }) => {
      if (!isDebugEnabled()) return [];
      return listDebugFiles(input.type, input.id);
    }),

  readFile: protectedProcedure
    .input(z.object({
      type: z.enum(['channel', 'dm']),
      id: z.string().min(1),
      filename: z.string().min(1),
    }))
    .query(({ input }) => {
      if (!isDebugEnabled()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Debug mode is not enabled' });
      }
      const content = readDebugFile(input.type, input.id, input.filename);
      if (content === null) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Debug file not found' });
      }
      return content;
    }),
});
