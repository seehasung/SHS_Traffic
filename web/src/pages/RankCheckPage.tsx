import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box,
  Button,
  Badge,
  Flex,
  Heading,
  HStack,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useToast,
  Progress,
  Spinner,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
} from '@chakra-ui/react';
import { FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import type { RankCheck } from '@shared/types';
import { api } from '@/api';

interface GroupedRank {
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  keywords: RankCheck[];
}

export default function RankCheckPage() {
  const [ranks, setRanks] = useState<RankCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const toast = useToast();
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await api.rankChecks.list();
      setRanks(items);
      const isRunning = await api.rankChecks.status();
      setChecking(isRunning);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // WebSocket으로 진행 상황 수신
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'rank:progress') {
          setProgress({ done: msg.done, total: msg.total, current: msg.current });
          setChecking(true);
        }
        if (msg.type === 'rank:complete') {
          setChecking(false);
          setProgress({ done: 0, total: 0, current: '' });
          load();
          toast({ title: '순위 조회 완료', status: 'success', position: 'top' });
        }
      } catch {
        // ignore
      }
    };

    return () => {
      ws.close();
    };
  }, [load, toast]);

  const startCheck = async () => {
    try {
      setChecking(true);
      setProgress({ done: 0, total: 0, current: '시작 중...' });
      await api.rankChecks.start();
    } catch (e: any) {
      toast({ title: e?.message ?? '순위 조회 시작 실패', status: 'error', position: 'top' });
      setChecking(false);
    }
  };

  const clearAll = async () => {
    if (!confirm('모든 순위 기록을 삭제하시겠습니까?')) return;
    await api.rankChecks.clear();
    setRanks([]);
  };

  // 상품별로 그룹핑
  const grouped: GroupedRank[] = [];
  const itemMap = new Map<string, GroupedRank>();
  for (const r of ranks) {
    let group = itemMap.get(r.itemName);
    if (!group) {
      group = { itemName: r.itemName, purchaseName: r.purchaseName, groupName: r.groupName, keywords: [] };
      itemMap.set(r.itemName, group);
      grouped.push(group);
    }
    group.keywords.push(r);
  }

  const totalKeywords = ranks.length;
  const foundCount = ranks.filter((r) => r.found).length;
  const notFoundCount = totalKeywords - foundCount;
  const avgRank = foundCount > 0
    ? Math.round(ranks.filter((r) => r.found && r.rankPosition).reduce((sum, r) => sum + (r.rankPosition ?? 0), 0) / foundCount)
    : 0;

  return (
    <Stack spacing={5}>
      <Flex justify="space-between" align="center">
        <Heading size="md">순위 추적</Heading>
        <HStack>
          <Button
            leftIcon={<FiTrash2 />}
            size="sm"
            variant="outline"
            colorScheme="red"
            onClick={clearAll}
            isDisabled={checking || ranks.length === 0}
          >
            기록 삭제
          </Button>
          <Button
            leftIcon={checking ? <Spinner size="xs" /> : <FiRefreshCw />}
            colorScheme="blue"
            onClick={startCheck}
            isLoading={checking}
            loadingText={`조회 중 (${progress.done}/${progress.total})`}
          >
            순위 조회 시작
          </Button>
        </HStack>
      </Flex>

      {checking && progress.total > 0 && (
        <Box bg="blue.50" borderRadius="md" p={4}>
          <Text fontSize="sm" mb={2}>
            {progress.current} ({progress.done}/{progress.total})
          </Text>
          <Progress
            value={(progress.done / progress.total) * 100}
            size="sm"
            colorScheme="blue"
            borderRadius="md"
          />
        </Box>
      )}

      {/* 요약 */}
      {ranks.length > 0 && (
        <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
          <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
            <StatLabel>전체 키워드</StatLabel>
            <StatNumber>{totalKeywords}</StatNumber>
          </Stat>
          <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
            <StatLabel>발견</StatLabel>
            <StatNumber color="green.500">{foundCount}</StatNumber>
          </Stat>
          <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
            <StatLabel>미발견</StatLabel>
            <StatNumber color="red.500">{notFoundCount}</StatNumber>
          </Stat>
          <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
            <StatLabel>평균 순위</StatLabel>
            <StatNumber color="blue.500">{avgRank > 0 ? `${avgRank}위` : '-'}</StatNumber>
          </Stat>
        </SimpleGrid>
      )}

      {/* 상품별 아코디언 */}
      {grouped.length > 0 ? (
        <Accordion allowMultiple defaultIndex={grouped.map((_, i) => i)}>
          {grouped.map((g) => (
            <AccordionItem key={g.itemName} borderWidth="1px" borderRadius="lg" mb={3}>
              <AccordionButton py={3}>
                <Flex flex="1" align="center" gap={3}>
                  <Text fontWeight="bold">상품번호: {g.itemName}</Text>
                  {g.purchaseName && (
                    <Text fontSize="sm" color="gray.500" isTruncated maxW="300px">
                      {g.purchaseName}
                    </Text>
                  )}
                  {g.groupName && (
                    <Badge colorScheme="purple" fontSize="2xs">{g.groupName}</Badge>
                  )}
                  <Badge colorScheme="blue" fontSize="2xs">
                    {g.keywords.length}개 키워드
                  </Badge>
                </Flex>
                <AccordionIcon />
              </AccordionButton>
              <AccordionPanel pb={4} px={2}>
                <Box overflowX="auto">
                  <Table size="sm">
                    <Thead bg="gray.50">
                      <Tr>
                        <Th>키워드</Th>
                        <Th>순위</Th>
                        <Th>조회 시각</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {g.keywords.map((r) => (
                        <Tr key={r.id}>
                          <Td fontWeight="medium">{r.keyword}</Td>
                          <Td>
                            {r.found ? (
                              <HStack>
                                <Badge colorScheme="green" fontSize="sm" px={2} py={1}>
                                  {r.pageNumber}페이지 {r.rankPosition}번
                                </Badge>
                              </HStack>
                            ) : (
                              <Badge colorScheme="red" fontSize="sm">미발견 (50p)</Badge>
                            )}
                          </Td>
                          <Td fontSize="xs" color="gray.500">
                            {new Date(r.checkedAt).toLocaleString('ko-KR')}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Box>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <Box borderWidth="1px" borderRadius="lg" p={8} textAlign="center">
          <Text color="gray.500">
            순위 기록이 없습니다. "순위 조회 시작" 버튼을 눌러 현재 순위를 확인하세요.
          </Text>
        </Box>
      )}
    </Stack>
  );
}
