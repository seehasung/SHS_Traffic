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
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure,
  IconButton,
} from '@chakra-ui/react';
import { WS_PATH } from '@shared/api';
import type { FailedKeyword, LogLevel, ServerMessage } from '@shared/types';
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
  const [failedKeywords, setFailedKeywords] = useState<FailedKeyword[]>([]);
  const { isOpen: isFailedOpen, onOpen: openFailed, onClose: closeFailed } = useDisclosure();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [workers, savedLogs, savedFailed] = await Promise.all([
        api.workers.list().catch(() => []),
        api.workerLogs.list(undefined, 1000).catch(() => []),
        api.workerFailedKeywords.list(undefined, 2000).catch(() => []),
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
      setFailedKeywords(savedFailed as FailedKeyword[]);
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
          if (msg.type === 'worker:failed-keyword') {
            setFailedKeywords((prev) => {
              const next = [msg.failed, ...prev];
              if (next.length > 3000) next.length = 3000;
              return next;
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

  const clearFailed = useCallback(async () => {
    if (!confirm(selectedWorker ? '선택된 워커의 실패 키워드를 모두 삭제하시겠습니까?' : '모든 워커의 실패 키워드를 모두 삭제하시겠습니까?')) return;
    await api.workerFailedKeywords.clear(selectedWorker || undefined);
    if (selectedWorker) {
      setFailedKeywords((prev) => prev.filter((f) => f.workerId !== selectedWorker));
    } else {
      setFailedKeywords([]);
    }
  }, [selectedWorker]);

  const removeFailed = useCallback(async (id: number) => {
    await api.workerFailedKeywords.remove(id);
    setFailedKeywords((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const reactivateKnowledge = useCallback(async (knowledgeId: string | undefined, keyword: string) => {
    if (!knowledgeId) {
      alert('이 항목은 키워드 ID 정보가 없어 자동 ON 할 수 없습니다. 키워드 관리 페이지에서 직접 ON 해주세요.');
      return;
    }
    if (!confirm(`키워드 "${keyword}" 를 다시 ON 하시겠습니까?`)) return;
    try {
      await api.knowledgesActive.set(knowledgeId, true);
      alert('다시 ON 처리되었습니다. 다음 사이클부터 워커가 작업을 재개합니다.');
    } catch (e) {
      alert('ON 처리 실패: ' + String((e as Error).message));
    }
  }, []);

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

  const filteredFailed = useMemo(() => {
    if (selectedWorker === null) return failedKeywords;
    return failedKeywords.filter((f) => f.workerId === selectedWorker);
  }, [failedKeywords, selectedWorker]);

  const failedCount = filteredFailed.length;

  return (
    <Stack spacing={5}>
      <HStack>
        <Heading size="md">실시간 로그</Heading>
        <Badge colorScheme={connected ? 'green' : 'gray'}>{connected ? '연결됨' : '연결 끊김'}</Badge>
        {loading && <Badge colorScheme="blue">불러오는 중...</Badge>}
        <Box flex={1} />
        <Button size="sm" onClick={openFailed} colorScheme="red" variant="solid">
          실패 로그 보기
          {failedCount > 0 && <Badge ml={2} colorScheme="whiteAlpha" variant="solid" color="red.500" bg="white">{failedCount}</Badge>}
        </Button>
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

      <Modal isOpen={isFailedOpen} onClose={closeFailed} size="6xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack>
              <Text>실패 키워드 / 상품 내역</Text>
              <Badge colorScheme="red">{filteredFailed.length}</Badge>
              {selectedWorker && (
                <Tag size="sm" colorScheme="teal">
                  워커: {workerList.find((w) => w.id === selectedWorker)?.name ?? selectedWorker}
                </Tag>
              )}
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {filteredFailed.length === 0 ? (
              <Flex h="200px" align="center" justify="center">
                <Text color="gray.400">실패한 키워드가 없습니다</Text>
              </Flex>
            ) : (
              <Table size="sm" variant="simple">
                <Thead position="sticky" top={0} bg="white" zIndex={1}>
                  <Tr>
                    <Th>발생시각</Th>
                    <Th>워커</Th>
                    <Th>그룹</Th>
                    <Th>키워드</Th>
                    <Th>상품번호</Th>
                    <Th>판매처</Th>
                    <Th isNumeric>검색 페이지</Th>
                    <Th>사유</Th>
                    <Th>액션</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filteredFailed.map((f) => (
                    <Tr key={f.id}>
                      <Td whiteSpace="nowrap" fontSize="xs" color="gray.500">
                        {new Date(f.createdAt).toLocaleString()}
                      </Td>
                      <Td><Tag size="sm" colorScheme="teal">{f.workerName}</Tag></Td>
                      <Td>{f.groupName ?? '-'}</Td>
                      <Td fontWeight="600">{f.keyword}</Td>
                      <Td><code>{f.itemName}</code></Td>
                      <Td>{f.purchaseName ?? '-'}</Td>
                      <Td isNumeric>
                        <Badge colorScheme="orange">{f.pagesScanned}</Badge>
                      </Td>
                      <Td fontSize="xs" color="red.600">{f.reason}</Td>
                      <Td>
                        <HStack spacing={1}>
                          <Button
                            size="xs"
                            colorScheme="green"
                            variant="outline"
                            isDisabled={!f.knowledgeId}
                            onClick={() => reactivateKnowledge(f.knowledgeId, f.keyword)}
                          >
                            다시 ON
                          </Button>
                          <IconButton
                            aria-label="기록 삭제"
                            size="xs"
                            variant="ghost"
                            colorScheme="red"
                            icon={<Text fontSize="md">×</Text>}
                            onClick={() => removeFailed(f.id)}
                          />
                        </HStack>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </ModalBody>
          <ModalFooter>
            <Button mr={3} colorScheme="red" variant="outline" onClick={clearFailed} isDisabled={filteredFailed.length === 0}>
              {selectedWorker ? '선택 워커 실패 전체 삭제' : '전체 실패 삭제'}
            </Button>
            <Button onClick={closeFailed}>닫기</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Stack>
  );
}
