import type { WebSocket } from 'ws';
import type { RealtimeEvent } from '@geotwin/shared';
export class RealtimeHub {
  private clients = new Set<WebSocket>();
  private alive = new WeakSet<WebSocket>();
  private heartbeat: ReturnType<typeof setInterval>;
  constructor() {
    this.heartbeat = setInterval(() => {
      for (const socket of this.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
    }, 30000);
    this.heartbeat.unref();
  }
  add(socket: WebSocket) {
    this.clients.add(socket);
    this.alive.add(socket);
    socket.on('pong', () => this.alive.add(socket));
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
    socket.send(
      JSON.stringify({
        type: 'sync:required',
        data: { connected_at: new Date().toISOString() },
      } satisfies RealtimeEvent),
    );
  }
  publish = (events: RealtimeEvent[]) => {
    for (const event of events)
      for (const socket of this.clients) {
        if (socket.readyState !== 1) continue;
        if (socket.bufferedAmount > 1024 * 1024) {
          socket.close(1013, 'Slow consumer; reconnect and sync');
          continue;
        }
        socket.send(JSON.stringify(event), (error) => {
          if (error) socket.terminate();
        });
      }
  };
  close() {
    clearInterval(this.heartbeat);
    for (const socket of this.clients) socket.close(1001, 'Server stopping');
  }
}
