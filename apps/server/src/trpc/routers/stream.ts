import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { t } from '../trpc';
import { protectedProcedure } from '../middleware';
import { TRPCError } from '@trpc/server';
import { subscribeChannel } from '../../services/stream-hub';

type StreamEvent = Record<string, unknown> & { type: string };

export const streamRouter = t.router({
  channel: protectedProcedure
    .input(z.object({ channelId: z.string().min(1) }))
    .subscription(({ ctx, input }) => {
      // Verify channel membership before allowing subscription
      const membership = ctx.db
        .prepare('SELECT 1 FROM channel_member WHERE channel_id = ? AND user_id = ?')
        .get(input.channelId, ctx.user.id);
      if (membership === undefined) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this channel' });
      }
      return observable<StreamEvent>(emit => {
        const unsubscribe = subscribeChannel(input.channelId, event => {
          emit.next(event);
        });
        return unsubscribe;
      });
    }),
});
