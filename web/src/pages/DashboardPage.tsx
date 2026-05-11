import { useEffect, useState } from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Heading,
  HStack,
  Stack,
  Text,
  useToast,
} from '@chakra-ui/react';
import { api } from '@/api';
import LogStream from '@/components/LogStream';
import type { Knowledge, NaverAccount, RunnerSnapshot, LogEntry } from '@shared/types';

interface Props {
  snapshot: RunnerSnapshot;
  logs: LogEntry[];
  connected: boolean;
}

export default function DashboardPage({ snapshot, logs, connected }: Props) {
  const [knowledges, setKnowledges] = useState<Knowledge[]>([]);
  const [accounts, setAccounts] = useState<NaverAccount[]>([]);
  const toast = useToast();

  useEffect(() => {
    api.knowledges.list().then(setKnowledges).catch(() => undefined);
    api.naverAccounts.list().then(setAccounts).catch(() => undefined);
  }, []);

  const onStart = async () => {
    try {
      await api.runner.start({
        selectedKnowledgeIds: knowledges.map((k) => k.id),
        selectedNaverAccountIds: accounts.map((a) => a.id),
      });
    } catch (e: any) {
      toast({ title: e?.message ?? String(e), status: 'error', position: 'top' });
    }
  };

  const onStop = async () => {
    try {
      await api.runner.stop();
    } catch (e: any) {
      toast({ title: e?.message ?? String(e), status: 'error', position: 'top' });
    }
  };

  const onClearLogs = async () => {
    await api.logs.clear();
  };

  return (
    <Stack spacing={6}>
      {!connected && (
        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          에이전트와의 실시간 연결이 끊어졌습니다. 자동 재연결을 시도하고 있습니다.
        </Alert>
      )}

      <Box borderWidth="1px" borderRadius="lg" p={4}>
        <HStack>
          <Stack spacing={0}>
            <Heading size="sm">실행 제어</Heading>
            <Text fontSize="xs" color="gray.500">
              현재 상태: {snapshot.status}
              {snapshot.currentStep ? ` · ${snapshot.currentStep}` : ''}
              {snapshot.progressCount ? ` · 진행 ${snapshot.progressCount}` : ''}
            </Text>
          </Stack>
          <Box flex={1} />
          <Button onClick={onClearLogs} size="sm" variant="ghost">
            로그 비우기
          </Button>
          <Button
            onClick={onStart}
            colorScheme="blue"
            isDisabled={snapshot.status !== 'idle' || knowledges.length === 0}
          >
            ▶ 시작
          </Button>
          <Button onClick={onStop} colorScheme="red" variant="outline" isDisabled={snapshot.status !== 'running'}>
            ■ 정지
          </Button>
        </HStack>
        {knowledges.length === 0 && (
          <Alert status="info" mt={3} borderRadius="md" size="sm">
            <AlertIcon />
            먼저 <b style={{ marginLeft: 4, marginRight: 4 }}>키워드/상품</b> 탭에서 작업할 항목을 등록해 주세요.
          </Alert>
        )}
      </Box>

      <Box>
        <Heading size="sm" mb={2}>
          실시간 로그
        </Heading>
        <LogStream logs={logs} />
      </Box>
    </Stack>
  );
}
