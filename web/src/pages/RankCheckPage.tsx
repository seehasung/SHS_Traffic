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
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Collapse,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Icon,
} from '@chakra-ui/react';
import { FiChevronDown, FiChevronRight, FiTrash2, FiTrendingUp, FiTrendingDown, FiMinus, FiClock } from 'react-icons/fi';
import type { RankCheck, Knowledge } from '@shared/types';
import { api } from '@/api';

type TrendStatus = 'up' | 'down' | 'maintain' | null;
type FilterType = 'tracked' | 'up' | 'maintain' | 'down' | 'outOfRank' | null;

interface KeywordRank {
  keyword: string;
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  rank?: RankCheck;
  yesterdayRank?: RankCheck;
  trend: TrendStatus;
}

interface GroupedProduct {
  itemName: string;
  purchaseName?: string;
  groupName?: string;
  keywords: KeywordRank[];
}

function getStartOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function computeTrend(todayRank?: RankCheck, yesterdayRank?: RankCheck): TrendStatus {
  if (!todayRank || !todayRank.found) return null;
  if (!yesterdayRank || !yesterdayRank.found) return null;

  const prevTotal = ((yesterdayRank.pageNumber ?? 1) - 1) * 40 + (yesterdayRank.rankPosition ?? 0);
  const currTotal = ((todayRank.pageNumber ?? 1) - 1) * 40 + (todayRank.rankPosition ?? 0);
  const diff = prevTotal - currTotal;

  if (diff > 0) return 'up';
  if (diff < 0) return 'down';
  return 'maintain';
}

function RankBadge({ rank }: { rank?: RankCheck }) {
  if (!rank) {
    return <Badge colorScheme="gray" fontSize="xs">미진행</Badge>;
  }
  if (!rank.found) {
    return <Badge colorScheme="orange" fontSize="xs">순위 밖</Badge>;
  }
  return (
    <Badge colorScheme="green" fontSize="sm" px={2} py={1} borderRadius="md">
      {rank.pageNumber}페이지 {rank.rankPosition}번
    </Badge>
  );
}

function TrendIndicator({ trend, current, previous }: { trend: TrendStatus; current?: RankCheck; previous?: RankCheck }) {
  if (!current || !current.found) return null;
  if (!previous) return null;
  if (!previous.found && current.found) {
    return <Text as="span" color="red.500" fontWeight="bold" fontSize="sm">NEW</Text>;
  }
  if (!previous.found || !current.found) return null;

  const prevTotal = ((previous.pageNumber ?? 1) - 1) * 40 + (previous.rankPosition ?? 0);
  const currTotal = ((current.pageNumber ?? 1) - 1) * 40 + (current.rankPosition ?? 0);
  const diff = prevTotal - currTotal;

  if (diff > 0) {
    return (
      <HStack spacing={0}>
        <Icon as={FiTrendingUp} color="red.500" boxSize={4} />
        <Text color="red.500" fontWeight="bold" fontSize="sm">▲ {diff}</Text>
      </HStack>
    );
  }
  if (diff < 0) {
    return (
      <HStack spacing={0}>
        <Icon as={FiTrendingDown} color="blue.500" boxSize={4} />
        <Text color="blue.500" fontWeight="bold" fontSize="sm">▼ {Math.abs(diff)}</Text>
      </HStack>
    );
  }
  return (
    <HStack spacing={0}>
      <Icon as={FiMinus} color="gray.400" boxSize={4} />
      <Text color="gray.400" fontSize="sm">유지</Text>
    </HStack>
  );
}

function ProductRow({ group, onShowHistory }: {
  group: GroupedProduct;
  onShowHistory: (itemName: string, keyword: string) => void;
}) {
  const { isOpen, onToggle } = useDisclosure();

  const trackedKeywords = group.keywords.filter((k) => k.rank?.found);
  const avgRank = trackedKeywords.length > 0
    ? Math.round(trackedKeywords.reduce((s, k) => s + (((k.rank!.pageNumber ?? 1) - 1) * 40 + (k.rank!.rankPosition ?? 0)), 0) / trackedKeywords.length)
    : null;

  return (
    <Box borderWidth="1px" borderRadius="lg" mb={3} bg="white">
      <Flex
        px={4} py={3}
        cursor="pointer"
        onClick={onToggle}
        align="center"
        _hover={{ bg: 'gray.50' }}
        borderBottomWidth={isOpen ? '1px' : 0}
      >
        <Icon as={isOpen ? FiChevronDown : FiChevronRight} mr={2} />
        <Box flex="1">
          <HStack spacing={3}>
            <Text fontWeight="bold" fontSize="md">{group.purchaseName || group.itemName}</Text>
            <Badge colorScheme="gray" fontSize="2xs">상품번호: {group.itemName}</Badge>
            {group.groupName && <Badge colorScheme="purple" fontSize="2xs">{group.groupName}</Badge>}
          </HStack>
        </Box>
        <HStack spacing={4}>
          <Text fontSize="sm" color="gray.500">{group.keywords.length}개 키워드</Text>
          {avgRank != null && (
            <Badge colorScheme="blue" fontSize="sm">평균 {avgRank}위</Badge>
          )}
          <Badge colorScheme={trackedKeywords.length === group.keywords.length ? 'green' : 'orange'} fontSize="xs">
            {trackedKeywords.length}/{group.keywords.length} 추적됨
          </Badge>
        </HStack>
      </Flex>

      <Collapse in={isOpen}>
        <Box px={2} pb={3}>
          <Table size="sm">
            <Thead bg="gray.50">
              <Tr>
                <Th>키워드</Th>
                <Th>현재 순위</Th>
                <Th>변동 (전일 대비)</Th>
                <Th>마지막 조회</Th>
                <Th>이력</Th>
              </Tr>
            </Thead>
            <Tbody>
              {group.keywords.map((k) => (
                <Tr key={`${k.itemName}-${k.keyword}`} bg={!k.rank ? 'gray.50' : undefined}>
                  <Td fontWeight="medium">{k.keyword}</Td>
                  <Td><RankBadge rank={k.rank} /></Td>
                  <Td><TrendIndicator trend={k.trend} current={k.rank} previous={k.yesterdayRank} /></Td>
                  <Td fontSize="xs" color="gray.500">
                    {k.rank ? new Date(k.rank.checkedAt).toLocaleString('ko-KR', {
                      month: 'numeric', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    }) : '-'}
                  </Td>
                  <Td>
                    {k.rank ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        leftIcon={<FiClock />}
                        onClick={() => onShowHistory(k.itemName, k.keyword)}
                      >
                        이력
                      </Button>
                    ) : (
                      <Text fontSize="xs" color="gray.400">-</Text>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      </Collapse>
    </Box>
  );
}

export default function RankCheckPage() {
  const [knowledges, setKnowledges] = useState<Knowledge[]>([]);
  const [ranks, setRanks] = useState<RankCheck[]>([]);
  const [allHistory, setAllHistory] = useState<Map<string, RankCheck[]>>(new Map());
  const [historyModal, setHistoryModal] = useState<{ itemName: string; keyword: string; items: RankCheck[] } | null>(null);
  const [filter, setFilter] = useState<FilterType>(null);
  const toast = useToast();
  const wsRef = useRef<WebSocket | null>(null);

  const loadRanks = useCallback(async () => {
    try {
      const items = await api.rankChecks.list();
      setRanks(items);

      const histMap = new Map<string, RankCheck[]>();
      for (const item of items) {
        const key = `${item.itemName}::${item.keyword}`;
        try {
          const hist = await api.rankChecks.history(item.itemName, item.keyword);
          histMap.set(key, hist);
        } catch {
          histMap.set(key, [item]);
        }
      }
      setAllHistory(histMap);
    } catch { /* ignore */ }
  }, []);

  const loadKnowledges = useCallback(async () => {
    try {
      const items = await api.knowledges.list();
      setKnowledges(items.filter((k) => k.mode === 'shopping' && k.isActive));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadKnowledges();
    loadRanks();
  }, [loadKnowledges, loadRanks]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'rank:update') {
          loadRanks();
        }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); };
  }, [loadRanks]);

  const clearAll = async () => {
    if (!confirm('모든 순위 기록을 삭제하시겠습니까?')) return;
    await api.rankChecks.clear();
    setRanks([]);
    setAllHistory(new Map());
  };

  const showHistory = async (itemName: string, keyword: string) => {
    try {
      const hist = await api.rankChecks.history(itemName, keyword);
      setHistoryModal({ itemName, keyword, items: hist });
    } catch {
      toast({ title: '이력 조회 실패', status: 'error', position: 'top' });
    }
  };

  const toggleFilter = (f: FilterType) => {
    setFilter((prev) => (prev === f ? null : f));
  };

  // 오늘/어제 날짜 경계 계산
  const now = new Date();
  const todayStart = getStartOfDay(now);
  const yesterdayStart = todayStart - 86400000;

  // 등록된 모든 키워드를 상품별로 그룹핑, 순위 데이터 매핑
  const rankMap = new Map<string, RankCheck>();
  for (const r of ranks) {
    rankMap.set(`${r.itemName}::${r.keyword}`, r);
  }

  // 각 키워드별 트렌드 계산 + KeywordRank 생성
  const allKeywordRanks: KeywordRank[] = [];

  for (const k of knowledges) {
    const rankKey = `${k.itemName}::${k.keyword}`;
    const currentRank = rankMap.get(rankKey);
    const history = allHistory.get(rankKey) || [];

    // 오늘 데이터: 오늘 날짜의 가장 최근 기록
    const todayRecord = history.find((h) => h.checkedAt >= todayStart);
    // 어제 데이터: 어제 날짜 범위의 가장 최근 기록
    const yesterdayRecord = history.find((h) => h.checkedAt >= yesterdayStart && h.checkedAt < todayStart);

    const trend = computeTrend(todayRecord || currentRank, yesterdayRecord);

    allKeywordRanks.push({
      keyword: k.keyword,
      itemName: k.itemName,
      purchaseName: k.purchaseName,
      groupName: k.groupName,
      rank: currentRank,
      yesterdayRank: yesterdayRecord,
      trend,
    });
  }

  // 통계 계산
  const totalKeywords = allKeywordRanks.length;
  const trackedCount = allKeywordRanks.filter((k) => k.rank).length;
  const upCount = allKeywordRanks.filter((k) => k.trend === 'up').length;
  const maintainCount = allKeywordRanks.filter((k) => k.trend === 'maintain').length;
  const downCount = allKeywordRanks.filter((k) => k.trend === 'down').length;
  const outOfRankCount = allKeywordRanks.filter((k) => k.rank && !k.rank.found).length;

  // 필터 적용
  const filteredKeywordRanks = allKeywordRanks.filter((k) => {
    if (!filter) return true;
    if (filter === 'tracked') return !!k.rank;
    if (filter === 'outOfRank') return !!k.rank && !k.rank.found;
    return k.trend === filter;
  });

  // 필터 적용된 키워드를 상품별로 그룹핑
  const grouped: GroupedProduct[] = [];
  const itemMap = new Map<string, GroupedProduct>();

  for (const k of filteredKeywordRanks) {
    let group = itemMap.get(k.itemName);
    if (!group) {
      group = {
        itemName: k.itemName,
        purchaseName: k.purchaseName,
        groupName: k.groupName,
        keywords: [],
      };
      itemMap.set(k.itemName, group);
      grouped.push(group);
    }
    group.keywords.push(k);
  }

  const statCardStyle = (active: boolean, borderColor: string) => ({
    bg: active ? `${borderColor}.50` : 'white',
    borderWidth: active ? '2px' : '1px',
    borderColor: active ? `${borderColor}.400` : 'gray.200',
    borderRadius: 'lg',
    p: 4,
    cursor: 'pointer' as const,
    transition: 'all 0.2s',
    _hover: { borderColor: `${borderColor}.300`, shadow: 'sm' },
  });

  return (
    <Stack spacing={5}>
      <Flex justify="space-between" align="center">
        <Heading size="md">순위 추적</Heading>
        <Button
          leftIcon={<FiTrash2 />}
          size="sm"
          variant="outline"
          colorScheme="red"
          onClick={clearAll}
          isDisabled={ranks.length === 0}
        >
          기록 삭제
        </Button>
      </Flex>

      <Box bg="blue.50" borderRadius="md" p={3}>
        <Text fontSize="sm" color="blue.700">
          워커 PC가 크롤링할 때 자동으로 상품 순위가 기록됩니다. 워커가 작동 중이면 실시간으로 업데이트됩니다.
        </Text>
      </Box>

      {/* 상단 4개 대시보드 */}
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>추적 상품</StatLabel>
          <StatNumber>{grouped.length}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>전체 키워드</StatLabel>
          <StatNumber>{totalKeywords}</StatNumber>
        </Stat>
        <Stat
          {...statCardStyle(filter === 'tracked', 'green')}
          onClick={() => toggleFilter('tracked')}
        >
          <StatLabel>추적됨</StatLabel>
          <StatNumber color="green.500">{trackedCount}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>미진행</StatLabel>
          <StatNumber color="gray.500">{totalKeywords - trackedCount}</StatNumber>
        </Stat>
      </SimpleGrid>

      {/* 하단 4개 대시보드 — 전일 대비 변동 */}
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <Stat
          {...statCardStyle(filter === 'up', 'red')}
          onClick={() => toggleFilter('up')}
        >
          <StatLabel>
            <HStack spacing={1}>
              <Icon as={FiTrendingUp} color="red.500" />
              <Text>상승</Text>
            </HStack>
          </StatLabel>
          <StatNumber color="red.500">{upCount}</StatNumber>
        </Stat>
        <Stat
          {...statCardStyle(filter === 'maintain', 'gray')}
          onClick={() => toggleFilter('maintain')}
        >
          <StatLabel>
            <HStack spacing={1}>
              <Icon as={FiMinus} color="gray.500" />
              <Text>유지</Text>
            </HStack>
          </StatLabel>
          <StatNumber color="gray.500">{maintainCount}</StatNumber>
        </Stat>
        <Stat
          {...statCardStyle(filter === 'down', 'blue')}
          onClick={() => toggleFilter('down')}
        >
          <StatLabel>
            <HStack spacing={1}>
              <Icon as={FiTrendingDown} color="blue.500" />
              <Text>하락</Text>
            </HStack>
          </StatLabel>
          <StatNumber color="blue.500">{downCount}</StatNumber>
        </Stat>
        <Stat
          {...statCardStyle(filter === 'outOfRank', 'orange')}
          onClick={() => toggleFilter('outOfRank')}
        >
          <StatLabel>
            <HStack spacing={1}>
              <Text>순위 밖</Text>
            </HStack>
          </StatLabel>
          <StatNumber color="orange.500">{outOfRankCount}</StatNumber>
        </Stat>
      </SimpleGrid>

      {filter && (
        <Flex align="center" gap={2}>
          <Badge colorScheme={
            filter === 'tracked' ? 'green' :
            filter === 'up' ? 'red' :
            filter === 'down' ? 'blue' :
            filter === 'outOfRank' ? 'orange' : 'gray'
          } fontSize="sm" px={2} py={1}>
            {filter === 'tracked' ? '추적됨' :
             filter === 'up' ? '상승' :
             filter === 'down' ? '하락' :
             filter === 'outOfRank' ? '순위 밖' : '유지'} 필터 적용 중
          </Badge>
          <Button size="xs" variant="ghost" onClick={() => setFilter(null)}>해제</Button>
        </Flex>
      )}

      {grouped.length > 0 ? (
        grouped.map((g) => (
          <ProductRow
            key={g.itemName}
            group={g}
            onShowHistory={showHistory}
          />
        ))
      ) : (
        <Box borderWidth="1px" borderRadius="lg" p={8} textAlign="center">
          <Text color="gray.500">
            {filter ? '해당 필터에 맞는 키워드가 없습니다.' : '등록된 키워드가 없습니다. 키워드/상품 관리에서 키워드를 추가해주세요.'}
          </Text>
        </Box>
      )}

      {/* 이력 모달 */}
      <Modal isOpen={!!historyModal} onClose={() => setHistoryModal(null)} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            순위 이력 — "{historyModal?.keyword}"
            <Text fontSize="sm" color="gray.500" fontWeight="normal">상품번호: {historyModal?.itemName}</Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            {historyModal?.items && historyModal.items.length > 0 ? (
              <Table size="sm">
                <Thead>
                  <Tr>
                    <Th>날짜/시간</Th>
                    <Th>순위</Th>
                    <Th>변동</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {historyModal.items.map((h, idx) => {
                    const prev = historyModal.items[idx + 1];
                    const t = computeTrend(h, prev);
                    return (
                      <Tr key={h.id}>
                        <Td fontSize="sm">
                          {new Date(h.checkedAt).toLocaleString('ko-KR', {
                            year: 'numeric', month: 'numeric', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </Td>
                        <Td><RankBadge rank={h} /></Td>
                        <Td><TrendIndicator trend={t} current={h} previous={prev} /></Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            ) : (
              <Text color="gray.500">이력이 없습니다.</Text>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </Stack>
  );
}
