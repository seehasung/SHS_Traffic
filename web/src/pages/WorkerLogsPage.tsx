import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Box,
  Button,
  Badge,
  Flex,
  Heading,
  HStack,
  Stack,
  Tag,
  Text,
} from '@chakra-ui/react';
import { WS_PATH } from '@shared/api';
import type { LogLevel, ServerMessage } from '@shared/types';
import { api } from '../api';

interface WorkerLog {
  id: number;
  workerId: string;
  workerName: string;
  message: string;
  level: LogLevel;
  createdAt: number;
}

interface WorkerInfo {
  id: string;
  name: string;
  progressCount: number;
}

function colorByLevel(level: LogLevel): string {
  switch (level) {
    case 'info': return 'gray.600';
    case 'warn': return 'orange.500';
    case 'error': return 'red.500';
    case 'success': return 'green.500';
    default: return 'gray.600';
  }
}

let logIdCounter = 0;

export default function WorkerLogsPage() {
  const [logs, setLogs] = useState<WorkerLog[]>([]);
  const [workerList, setWorkerList] = useState<WorkerInfo[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [workers, savedLogs] = await Promise.all([
        api.workers.list().catch(() => []),
        api.workerLogs.list(undefined, 1000).catch(() => []),
      ]);
      setWorkerList(workers.map((w) => ({ id: w.id, name: w.name, progressCount: 0 })));
      setLogs(savedLogs.map((l) => ({
        id: ++logIdCounter,
        workerId: l.workerId,
        workerName: l.workerName,
        message: l.message,
        level: l.level,
        createdAt: l.createdAt,
      })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  useEffect(() => {
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'subscribe' }));
      };

      ws.onclose = () => {
        setConnected(false);
        if (!stopped) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMessage;
          if (msg.type === 'worker:log') {
            const newLog: WorkerLog = {
              id: ++logIdCounter,
              workerId: msg.workerId,
              workerName: msg.workerName,
              message: msg.entry.message,
              level: msg.entry.level,
              createdAt: msg.entry.createdAt,
            };
            setLogs((prev) => {
              const next = [...prev, newLog];
              if (next.length > 3000) next.splice(0, next.length - 3000);
              return next;
            });
            setWorkerList((prev) => {
              if (prev.some((w) => w.id === msg.workerId)) return prev;
              return [...prev, { id: msg.workerId, name: msg.workerName, progressCount: 0 }];
            });
          }
          if (msg.type === 'worker:status') {
            const s = msg.status;
            setWorkerList((prev) => {
              const existing = prev.find((w) => w.id === s.workerId);
              if (existing) {
                if (existing.progressCount === s.progressCount) return prev;
                return prev.map((w) => w.id === s.workerId ? { ...w, progressCount: s.progressCount } : w);
              }
              return [...prev, { id: s.workerId, name: s.workerName, progressCount: s.progressCount }];
            });
          }
        } catch { /* ignore */ }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

  const clearLogs = useCallback(async () => {
    if (!confirm(selectedWorker ? '선택된 워커의 로그를 삭제하시겠습니까?' : '모든 로그를 삭제하시겠습니까?')) return;
    await api.workerLogs.clear(selectedWorker || undefined);
    if (selectedWorker) {
      setLogs((prev) => prev.filter((l) => l.workerId !== selectedWorker));
    } else {
      setLogs([]);
    }
  }, [selectedWorker]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, selectedWorker]);

  const filteredLogs = useMemo(() => {
    if (selectedWorker === null) return logs;
    return logs.filter((l) => l.workerId === selectedWorker);
  }, [logs, selectedWorker]);

  return (
    <Stack spacing={5}>
      <HStack>
        <Heading size="md">실시간 로그</Heading>
        <Badge colorScheme={connected ? 'green' : 'gray'}>{connected ? '연결됨' : '연결 끊김'}</Badge>
        {loading && <Badge colorScheme="blue">불러오는 중...</Badge>}
        <Box flex={1} />
        <Button size="sm" onClick={loadInitialData} variant="outline">새로고침</Button>
        <Button size="sm" onClick={clearLogs} colorScheme="red" variant="outline">
          {selectedWorker ? '선택 워커 로그 삭제' : '전체 로그 삭제'}
        </Button>
      </HStack>

      <Flex gap={4} align="stretch" minH="600px">
        <Box w="200px" borderWidth="1px" borderRadius="lg" p={3}>
          <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={2}>워커 PC</Text>
          <Button
            w="100%"
            mb={2}
            size="sm"
            variant={selectedWorker === null ? 'solid' : 'ghost'}
            colorScheme="blue"
            onClick={() => setSelectedWorker(null)}
          >
            전체
          </Button>
          {workerList.map((w) => (
            <Button
              key={w.id}
              w="100%"
              mb={1}
              size="sm"
              variant={selectedWorker === w.id ? 'solid' : 'ghost'}
              onClick={() => setSelectedWorker(w.id)}
              justifyContent="space-between"
            >
              <Text isTruncated>{w.name}</Text>
              <Badge ml={1} colorScheme="purple">{w.progressCount}회</Badge>
            </Button>
          ))}
          {workerList.length === 0 && (
            <Text fontSize="xs" color="gray.400" textAlign="center" py={4}>
              아직 수신된 로그가 없습니다
            </Text>
          )}
        </Box>

        <Box flex={1} borderWidth="1px" borderRadius="lg" p={4} overflowY="auto" maxH="700px" ref={logContainerRef}>
          {filteredLogs.length === 0 ? (
            <Flex h="100%" align="center" justify="center">
              <Text color="gray.400">로그가 없습니다</Text>
            </Flex>
          ) : (
            filteredLogs.map((log) => (
              <HStack key={log.id} spacing={2} py={1} borderBottomWidth="1px" borderColor="gray.100">
                <Text fontSize="xs" color="gray.400" whiteSpace="nowrap">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </Text>
                {selectedWorker === null && (
                  <Tag size="sm" colorScheme="teal">{log.workerName}</Tag>
                )}
                <Text fontSize="sm" color={colorByLevel(log.level)}>{log.message}</Text>
              </HStack>
            ))
          )}
        </Box>
      </Flex>
    </Stack>
  );
}
