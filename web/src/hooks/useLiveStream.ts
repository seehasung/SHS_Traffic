import { useEffect, useRef, useState } from 'react';
import { WS_PATH } from '@shared/api';
import type { LogEntry, RunnerSnapshot, ServerMessage } from '@shared/types';
import { INITIAL_SNAPSHOT } from '@shared/types';

interface State {
  connected: boolean;
  logs: LogEntry[];
  snapshot: RunnerSnapshot;
}

/**
 * 에이전트와 WebSocket 으로 양방향 통신.
 * 자동 재연결(2초 backoff)과 초기 로그 정렬을 포함한다.
 */
export function useLiveStream(initialLogs: LogEntry[]) {
  const [state, setState] = useState<State>({
    connected: false,
    logs: initialLogs,
    snapshot: { ...INITIAL_SNAPSHOT },
  });
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
      wsRef.current = ws;

      ws.onopen = () => setState((s) => ({ ...s, connected: true }));
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!stopped) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMessage;
          setState((prev) => {
            if (msg.type === 'log') {
              const next = [...prev.logs, msg.entry];
              if (next.length > 500) next.splice(0, next.length - 500);
              return { ...prev, logs: next };
            }
            if (msg.type === 'snapshot') return { ...prev, snapshot: msg.snapshot };
            if (msg.type === 'log:cleared') return { ...prev, logs: [] };
            return prev;
          });
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return state;
}
