import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Center, Spinner } from '@chakra-ui/react';
import { useSession } from '@/hooks/useSession';
import { useLiveStream } from '@/hooks/useLiveStream';
import LoginPage from '@/pages/LoginPage';
import AgentDownPage from '@/pages/AgentDownPage';
import DashboardPage from '@/pages/DashboardPage';
import KnowledgesPage from '@/pages/KnowledgesPage';
import NaverAccountsPage from '@/pages/NaverAccountsPage';
import SettingsPage from '@/pages/SettingsPage';
import WorkersPage from '@/pages/WorkersPage';
import Layout from '@/components/Layout';
import { api } from '@/api';
import type { LogEntry } from '@shared/types';

export default function App() {
  const session = useSession();
  const [agentReachable, setAgentReachable] = useState<boolean | null>(null);
  const [initialLogs, setInitialLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/setup-status', { credentials: 'include' })
      .then((r) => !cancelled && setAgentReachable(r.ok))
      .catch(() => !cancelled && setAgentReachable(false));
    return () => {
      cancelled = true;
    };
  }, [session.phase]);

  useEffect(() => {
    if (session.phase === 'authed') {
      api.logs.list().then(setInitialLogs).catch(() => undefined);
    }
  }, [session.phase]);

  if (session.phase === 'loading' || agentReachable === null) {
    return (
      <Center h="100vh">
        <Spinner />
      </Center>
    );
  }

  if (agentReachable === false) {
    return <AgentDownPage onRetry={() => session.refresh()} />;
  }

  if (session.phase === 'first-run') {
    return <LoginPage mode="first-run" onAuthed={session.refresh} />;
  }

  if (session.phase === 'guest') {
    return <LoginPage mode="guest" onAuthed={session.refresh} />;
  }

  return (
    <Authed
      initialLogs={initialLogs}
      email={session.user?.email}
      isAdmin={session.isAdmin}
      onSignedOut={session.refresh}
    />
  );
}

function Authed({
  initialLogs,
  email,
  isAdmin,
  onSignedOut,
}: {
  initialLogs: LogEntry[];
  email?: string;
  isAdmin: boolean;
  onSignedOut: () => void;
}) {
  const live = useLiveStream(initialLogs);

  return (
    <BrowserRouter>
      <Layout email={email} connected={live.connected} status={live.snapshot.status} isAdmin={isAdmin} onSignedOut={onSignedOut}>
        <Routes>
          <Route
            path="/"
            element={
              isAdmin
                ? <WorkersPage />
                : <DashboardPage snapshot={live.snapshot} logs={live.logs} connected={live.connected} />
            }
          />
          <Route path="/knowledges" element={<KnowledgesPage isAdmin={isAdmin} />} />
          <Route path="/naver-accounts" element={<NaverAccountsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {isAdmin && <Route path="/workers" element={<WorkersPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
