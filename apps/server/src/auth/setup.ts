import { betterAuth } from 'better-auth';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../db/client';

const PORT = Number(process.env['PORT'] ?? 3002);

export const auth = betterAuth({
  baseURL: process.env['BETTER_AUTH_BASE_URL'] ?? `http://localhost:${PORT}`,
  database: getDatabase(),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24, // 24 hours
  },
  trustedOrigins: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:3002',
  ],
});

export async function registerAuthPlugin(app: FastifyInstance): Promise<void> {
  app.all('/api/auth/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const response = await auth.handler(toWebRequest(request));
    return sendWebResponse(reply, response);
  });
}

function toWebRequest(request: FastifyRequest): Request {
  const protocol = request.protocol ?? 'http';
  const host = request.hostname ?? 'localhost';
  const url = new URL(request.url, `${protocol}://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(url, {
    method: request.method,
    headers,
    body:
      request.method !== 'GET' && request.method !== 'HEAD' ? JSON.stringify(request.body) : null,
  });
}

async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
  reply.status(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });
  const body = await response.text();
  reply.send(body);
}
