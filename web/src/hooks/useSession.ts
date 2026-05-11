import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/api';
import type { UserAccount } from '@shared/types';

type Phase = 'loading' | 'first-run' | 'guest' | 'authed';

interface SessionState {
  phase: Phase;
  user: UserAccount | null;
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ phase: 'loading', user: null });

  const refresh = useCallback(async () => {
    try {
      const { firstRun } = await api.setupStatus();
      if (firstRun) {
        setState({ phase: 'first-run', user: null });
        return;
      }
      try {
        const { user } = await api.me();
        setState({ phase: 'authed', user: { ...user, role: user.role ?? 'admin' } as UserAccount });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setState({ phase: 'guest', user: null });
          return;
        }
        throw e;
      }
    } catch (e) {
      setState({ phase: 'guest', user: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isAdmin = state.user?.role === 'admin';
  const isWorker = state.user?.role === 'worker';

  return { ...state, refresh, isAdmin, isWorker };
}
