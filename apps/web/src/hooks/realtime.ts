import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { realtimeEventSchema, type RealtimeEvent } from '@geotwin/shared';
import { applyRealtimeEvents } from './realtime-cache';
import { useUI } from '../stores/ui';
export function useRealtime() {
  const client = useQueryClient();
  const setConnection = useUI((s) => s.setConnection);
  useEffect(() => {
    let stopped = false,
      attempt = 0;
    let socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      flush: ReturnType<typeof setTimeout> | undefined;
    let pending: RealtimeEvent[] = [];
    const sync = () => {
      void client.invalidateQueries({ queryKey: ['geo'] });
    };
    const connect = () => {
      if (stopped) return;
      clearTimeout(retry);
      setConnection('connecting');
      const current = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`,
      );
      socket = current;
      current.onopen = () => {
        if (stopped || socket !== current) return;
        attempt = 0;
        setConnection('connected');
        sync();
        void client.invalidateQueries({ queryKey: ['health'] });
      };
      current.onmessage = (event) => {
        try {
          const parsed = realtimeEventSchema.safeParse(JSON.parse(String(event.data)) as unknown);
          if (!parsed.success) return;
          if (parsed.data.type === 'sync:required') {
            sync();
            return;
          }
          // A tick carries dozens of readings: apply them to the cache in one 200 ms batch.
          pending.push(parsed.data);
          if (!flush)
            flush = setTimeout(() => {
              flush = undefined;
              const batch = pending;
              pending = [];
              applyRealtimeEvents(client, batch);
            }, 200);
        } catch {
          /* Invalid external messages never replace validated API data. */
        }
      };
      current.onerror = () => current.close();
      current.onclose = () => {
        if (stopped || socket !== current) return;
        setConnection('offline');
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempt++) + Math.random() * 250);
      };
    };
    connect();
    const recover = () => {
      if (socket?.readyState === WebSocket.OPEN) sync();
    };
    const online = () => {
      if (socket?.readyState !== WebSocket.OPEN) {
        clearTimeout(retry);
        socket?.close();
        connect();
      }
    };
    window.addEventListener('focus', recover);
    window.addEventListener('online', online);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(flush);
      socket?.close();
      window.removeEventListener('focus', recover);
      window.removeEventListener('online', online);
    };
  }, [client, setConnection]);
}
