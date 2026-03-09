import { config } from 'dotenv';
import { resolve } from 'path';
import { findProjectRoot, startChatTranscript } from '@cebus/engine';
config({ path: resolve(findProjectRoot(), '.env') });
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { isWithinDir } from './utils/paths';
import { getDatabase, closeDatabase } from './db/client';
import { initializeDatabase } from './db/schema';
import { seedDefaultWorkspace } from './db/seed';
import { auth, registerAuthPlugin } from './auth/setup';
import { appRouter } from './trpc/router';
import { createContext } from './trpc/context';
import { subscribeChannel } from './services/stream-hub';

const PORT = Number(process.env['PORT'] ?? 3002);
const HOST = process.env['HOST'] ?? '127.0.0.1';

async function start(): Promise<void> {
  const app = Fastify({
    logger: true,
    trustProxy: process.env['TRUST_PROXY'] === 'true',
  });

  const corsOrigins = process.env['CORS_ORIGINS'];
  const allowedOrigins =
    corsOrigins !== undefined && corsOrigins.length > 0
      ? corsOrigins.split(',').map(o => o.trim())
      : [
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
          'http://localhost:3002',
        ];
  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws://localhost:*', 'wss://localhost:*', ...allowedOrigins],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    allowList: [],
    keyGenerator: request => request.ip ?? '127.0.0.1',
  });

  // Stricter rate limit for auth endpoints
  app.after(() => {
    app.register(
      async authScope => {
        await authScope.register(rateLimit, {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: request => request.ip ?? '127.0.0.1',
        });
      },
      { prefix: '/api/auth' }
    );
  });

  await app.register(fastifyWebsocket);

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB per file
      files: 5, // max 5 files per request
    },
  });

  const db = getDatabase();
  initializeDatabase(db);
  seedDefaultWorkspace(db);

  await registerAuthPlugin(app);

  await app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: { router: appRouter, createContext },
  });

  // SSE endpoint for real-time channel events (authenticated)
  app.get('/api/stream/:channelId', async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

    // Validate channelId format (ULID: 26 alphanumeric chars)
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(channelId)) {
      reply.status(400).send('Bad Request: Invalid channel ID format');
      return;
    }

    // Authenticate via session cookie
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const session = await auth.api.getSession({ headers });
    if (session === null || session === undefined || session.user === undefined) {
      reply.status(401).send('Unauthorized');
      return;
    }

    // Verify channel membership
    const membership = db
      .prepare('SELECT 1 FROM channel_member WHERE channel_id = ? AND user_id = ?')
      .get(channelId, session.user.id);
    if (membership === undefined) {
      reply.status(403).send('Forbidden');
      return;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send keepalive
    const keepalive = setInterval(() => {
      reply.raw.write(':keepalive\n\n');
    }, 15000);

    let cleaned = false;
    const unsubscribe = subscribeChannel(channelId, event => {
      if (!cleaned) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepalive);
      unsubscribe();
    };

    request.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
  });

  // File upload endpoint (authenticated)
  const ALLOWED_UPLOAD_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.txt', '.md', '.ts', '.tsx', '.js', '.jsx', '.py',
    '.json', '.yaml', '.yml', '.toml', '.csv', '.xml',
    '.html', '.css', '.scss', '.sh', '.sql', '.rs', '.go',
  ]);

  app.post('/api/upload/:channelId', async (request, reply) => {
    const { channelId } = request.params as { channelId: string };

    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(channelId)) {
      reply.status(400).send({ error: 'Invalid channel ID' });
      return;
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const session = await auth.api.getSession({ headers });
    if (session === null || session === undefined || session.user === undefined) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const membership = db
      .prepare('SELECT 1 FROM channel_member WHERE channel_id = ? AND user_id = ?')
      .get(channelId, session.user.id);
    if (membership === undefined) {
      reply.status(403).send({ error: 'Forbidden' });
      return;
    }

    const uploadDir = resolve(dataDir, 'uploads', channelId);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- channelId is ULID-validated
    mkdirSync(uploadDir, { recursive: true });

    const uploadedFiles: Array<{ path: string; url: string; fileName: string; type: string }> = [];

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = extname(part.filename).toLowerCase();
        if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
          reply.status(400).send({ error: `File type not allowed: ${ext}` });
          return;
        }

        const safeFileName = `${Date.now()}-${part.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        // Path traversal check
        const targetPath = join(uploadDir, safeFileName);
        if (!isWithinDir(targetPath, uploadDir)) {
          reply.status(400).send({ error: 'Invalid filename' });
          return;
        }

        const buf = await part.toBuffer();
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- safeFileName sanitized, path validated
        writeFileSync(targetPath, buf);
        uploadedFiles.push({
          path: targetPath,
          url: `/api/uploads/${channelId}/${safeFileName}`,
          fileName: part.filename,
          type: part.mimetype,
        });
      }
    }

    reply.send({ files: uploadedFiles });
  });

  const webDistPath = resolve(import.meta.dirname, '../../web/dist');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from import.meta
  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, { root: webDistPath, prefix: '/' });
  }

  const dataDir = resolve(process.env['DATABASE_URL'] ?? './data', '..');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from config
  mkdirSync(dataDir, { recursive: true });

  const uploadsPath = resolve(dataDir, 'uploads');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path derived from config
  if (existsSync(uploadsPath)) {
    await app.register(
      async function uploadsScope(scope) {
        // Authenticate every request to uploaded files
        scope.addHook('preHandler', async (request, reply) => {
          const hdrs = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (value !== undefined) hdrs.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          const session = await auth.api.getSession({ headers: hdrs });
          if (!session?.user) {
            return reply.status(401).send('Unauthorized');
          }
        });

        await scope.register(fastifyStatic, {
          root: uploadsPath,
          prefix: '/api/uploads/',
          decorateReply: false,
          setHeaders: (res) => {
            // Force download to prevent SVG/HTML XSS via inline rendering
            res.setHeader('Content-Disposition', 'attachment');
            res.setHeader('X-Content-Type-Options', 'nosniff');
          },
        });
      }
    );
  }

  startChatTranscript('Cebus Web');

  await app.listen({ port: PORT, host: HOST });
  console.warn(`Server listening on http://${HOST}:${PORT}`);
}

async function shutdown(): Promise<void> {
  closeDatabase();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown().catch(console.error);
});
process.on('SIGTERM', () => {
  shutdown().catch(console.error);
});

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
