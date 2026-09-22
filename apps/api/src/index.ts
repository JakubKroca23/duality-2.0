import { serve } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import { initDb } from './db.js';
import { app } from './routes.js';
import { resumeAllRunning, subscribeRun, type WsEvent } from './simManager.js';

const PORT = Number(process.env.PORT ?? 8787);

async function main(): Promise<void> {
  await initDb();
  await resumeAllRunning();

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[api] http://localhost:${info.port}`);
  });

  const wss = new WebSocketServer({ server: server as import('node:http').Server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    const unsubs: Array<() => void> = [];

    socket.on('message', (raw) => {
      let msg: { type?: string; runId?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'subscribe' && msg.runId) {
        const runId = msg.runId;
        const unsub = subscribeRun(runId, (event: WsEvent) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        });
        unsubs.push(unsub);
        socket.send(JSON.stringify({ type: 'subscribed', runId }));
      }
    });

    socket.on('close', () => {
      for (const u of unsubs) u();
    });
  });

  console.log(`[api] ws://localhost:${PORT}/ws`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
