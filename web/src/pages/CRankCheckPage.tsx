import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box, Badge, Button, Divider, Flex, Heading, HStack, Stack, Table, Tbody, Td, Text, Th, Thead, Tr,
  useToast, SimpleGrid, Stat, StatLabel, StatNumber, Collapse, useDisclosure,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, Icon,
} from '@chakra-ui/react';
import { FiChevronDown, FiChevronRight, FiTrendingUp, FiTrendingDown, FiMinus, FiClock, FiMousePointer } from 'react-icons/fi';
import type { CRankCheck, CRankKnowledge } from '@shared/types';
import { api } from '@/api';

type TrendStatus = 'up' | 'down' | 'maintain' | null;
type FilterType = 'tracked' | 'up' | 'maintain' | 'down' | 'outOfRank' | null;

interface ClickStats {
  today: number; yesterday: number; dayBefore: number; thisWeek: number;
  todayPerKeyword: { keyword: string; cafeName: string; postTitle: string; count: number }[];
}

interface KeywordRank {
  keyword: string; cafeName: string; postTitle: string; groupName?: string;
  rank?: CRankCheck; yesterdayRank?: CRankCheck; trend: TrendStatus; todayClicks: number;
}

interface GroupedKeyword {
  keyword: string;
  entries: KeywordRank[];
}

function getStartOfDay(date: Date): number {
  const d = new Date(date); d.setHours(0, 0, 0, 0); return d.getTime();
}

function computeTrend(todayRank?: CRankCheck, yesterdayRank?: CRankCheck): TrendStatus {
  if (!todayRank || !todayRank.found) return null;
  if (!yesterdayRank || !yesterdayRank.found) return null;
  const prev = yesterdayRank.rankPosition ?? 0;
  const curr = todayRank.rankPosition ?? 0;
  if (prev > curr && curr > 0) return 'up';
  if (prev < curr) return 'down';
  if (prev === curr) return 'maintain';
  return null;
}

function CRankBadge({ rank }: { rank?: CRankCheck }) {
  if (!rank) return <Badge colorScheme="gray" fontSize="xs">미진행</Badge>;
  if (!rank.found) return <Badge colorScheme="orange" fontSize="xs">순위 밖</Badge>;
  return <Badge colorScheme="green" fontSize="sm" px={2} py={1} borderRadius="md">{rank.rankPosition}위</Badge>;
}

function CRankTrendIndicator({ trend, current, previous }: { trend: TrendStatus; current?: CRankCheck; previous?: CRankCheck }) {
  if (!current || !current.found) return null;
  if (!previous) return null;
  if (!previous.found && current.found) return <Text as="span" color="red.500" fontWeight="bold" fontSize="sm">NEW</Text>;
  if (!previous.found || !current.found) return null;
  const prev = previous.rankPosition ?? 0;
  const curr = current.rankPosition ?? 0;
  const diff = prev - curr;
  if (diff > 0) return <HStack spacing={0}><Icon as={FiTrendingUp} color="red.500" boxSize={4} /><Text color="red.500" fontWeight="bold" fontSize="sm">▲ {diff}</Text></HStack>;
  if (diff < 0) return <HStack spacing={0}><Icon as={FiTrendingDown} color="blue.500" boxSize={4} /><Text color="blue.500" fontWeight="bold" fontSize="sm">▼ {Math.abs(diff)}</Text></HStack>;
  return <HStack spacing={0}><Icon as={FiMinus} color="gray.400" boxSize={4} /><Text color="gray.400" fontSize="sm">유지</Text></HStack>;
}

function KeywordGroup({ group, onShowHistory, onShowClickHistory }: {
  group: GroupedKeyword;
  onShowHistory: (kw: string, cn: string, pt: string) => void;
  onShowClickHistory: (kw: string, cn: string, pt: string) => void;
}) {
  const { isOpen, onToggle } = useDisclosure();
  const tracked = group.entries.filter((e) => e.rank?.found);
  const totalClicks = group.entries.reduce((s, e) => s + e.todayClicks, 0);

  return (
    <Box borderWidth="1px" borderRadius="lg" mb={3} bg="white">
      <Flex px={4} py={3} cursor="pointer" onClick={onToggle} align="center" _hover={{ bg: 'gray.50' }} borderBottomWidth={isOpen ? '1px' : 0}>
        <Icon as={isOpen ? FiChevronDown : FiChevronRight} mr={2} />
        <Box flex="1">
          <Text fontWeight="bold" fontSize="md">{group.keyword}</Text>
        </Box>
        <HStack spacing={4}>
          <Text fontSize="sm" color="gray.500">{group.entries.length}개 카페</Text>
          {totalClicks > 0 && <Badge colorScheme="teal" fontSize="xs">오늘 {totalClicks}클릭</Badge>}
          <Badge colorScheme={tracked.length === group.entries.length ? 'green' : 'orange'} fontSize="xs">
            {tracked.length}/{group.entries.length} 추적됨
          </Badge>
        </HStack>
      </Flex>
      <Collapse in={isOpen}>
        <Box px={2} pb={3}>
          <Table size="sm">
            <Thead bg="gray.50">
              <Tr>
                <Th>카페명</Th>
                <Th>글 제목</Th>
                <Th>현재 순위</Th>
                <Th>변동</Th>
                <Th>오늘 클릭</Th>
                <Th>마지막 조회</Th>
                <Th>이력</Th>
              </Tr>
            </Thead>
            <Tbody>
              {group.entries.map((e) => (
                <Tr key={`${e.keyword}-${e.cafeName}-${e.postTitle}`} bg={!e.rank ? 'gray.50' : undefined}>
                  <Td fontSize="sm">{e.cafeName}</Td>
                  <Td fontSize="sm">{e.postTitle}</Td>
                  <Td><CRankBadge rank={e.rank} /></Td>
                  <Td><CRankTrendIndicator trend={e.trend} current={e.rank} previous={e.yesterdayRank} /></Td>
                  <Td>
                    {e.todayClicks > 0 ? <Badge colorScheme="teal" fontSize="xs">{e.todayClicks}회</Badge> : <Text fontSize="xs" color="gray.400">0</Text>}
                  </Td>
                  <Td fontSize="xs" color="gray.500">
                    {e.rank ? new Date(e.rank.checkedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </Td>
                  <Td>
                    <HStack spacing={1}>
                      {e.rank ? <Button size="xs" variant="ghost" leftIcon={<FiClock />} onClick={() => onShowHistory(e.keyword, e.cafeName, e.postTitle)}>순위</Button> : <Text fontSize="xs" color="gray.400">-</Text>}
                      <Button size="xs" variant="ghost" leftIcon={<FiMousePointer />} onClick={() => onShowClickHistory(e.keyword, e.cafeName, e.postTitle)}>클릭</Button>
                    </HStack>
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

export default function CRankCheckPage() {
  const [crankKnowledges, setCrankKnowledges] = useState<CRankKnowledge[]>([]);
  const [ranks, setRanks] = useState<CRankCheck[]>([]);
  const [allHistory, setAllHistory] = useState<Map<string, CRankCheck[]>>(new Map());
  const [clickStats, setClickStats] = useState<ClickStats>({ today: 0, yesterday: 0, dayBefore: 0, thisWeek: 0, todayPerKeyword: [] });
  const [historyModal, setHistoryModal] = useState<{ keyword: string; cafeName: string; postTitle: string; items: CRankCheck[] } | null>(null);
  const [clickHistoryModal, setClickHistoryModal] = useState<{ keyword: string; cafeName: string; postTitle: string; items: { date: string; count: number }[] } | null>(null);
  const [filter, setFilter] = useState<FilterType>(null);
  const toast = useToast();
  const wsRef = useRef<WebSocket | null>(null);

  const loadRanks = useCallback(async () => {
    try {
      const items = await api.crankChecks.list();
      setRanks(items);
      const histMap = new Map<string, CRankCheck[]>();
      for (const item of items) {
        const key = `${item.keyword}::${item.cafeName}::${item.postTitle}`;
        try {
          const hist = await api.crankChecks.history(item.keyword, item.cafeName, item.postTitle);
          histMap.set(key, hist);
        } catch { histMap.set(key, [item]); }
      }
      setAllHistory(histMap);
    } catch { /* ignore */ }
  }, []);

  const loadClickStats = useCallback(async () => {
    try { setClickStats(await api.crankClickStats.get()); } catch { /* ignore */ }
  }, []);

  const loadKnowledges = useCallback(async () => {
    try { setCrankKnowledges(await api.crankKnowledges.list()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadKnowledges(); loadRanks(); loadClickStats(); }, [loadKnowledges, loadRanks, loadClickStats]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'crank:update') { loadRanks(); loadClickStats(); }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); };
  }, [loadRanks, loadClickStats]);

  const toggleFilter = (f: FilterType) => setFilter((prev) => (prev === f ? null : f));

  const showHistory = async (kw: string, cn: string, pt: string) => {
    try {
      const items = await api.crankChecks.history(kw, cn, pt);
      setHistoryModal({ keyword: kw, cafeName: cn, postTitle: pt, items });
    } catch { toast({ title: '이력 조회 실패', status: 'error', position: 'top' }); }
  };

  const showClickHistory = async (kw: string, cn: string, pt: string) => {
    try {
      const items = await api.crankClickStats.history(kw, cn, pt);
      setClickHistoryModal({ keyword: kw, cafeName: cn, postTitle: pt, items });
    } catch { toast({ title: '클릭 이력 조회 실패', status: 'error', position: 'top' }); }
  };

  const now = new Date();
  const todayStart = getStartOfDay(now);
  const yesterdayStart = todayStart - 86400000;

  const rankMap = new Map<string, CRankCheck>();
  for (const r of ranks) rankMap.set(`${r.keyword}::${r.cafeName}::${r.postTitle}`, r);

  const clickMap = new Map<string, number>();
  for (const c of clickStats.todayPerKeyword) clickMap.set(`${c.keyword}::${c.cafeName}::${c.postTitle}`, c.count);

  const allKeywordRanks: KeywordRank[] = [];
  const activeKnowledges = crankKnowledges.filter((k) => k.isActive);
  for (const k of activeKnowledges) {
    const key = `${k.keyword}::${k.cafeName}::${k.postTitle}`;
    const currentRank = rankMap.get(key);
    const history = allHistory.get(key) || [];
    const todayRecord = history.find((h) => h.checkedAt >= todayStart);
    const yesterdayRecord = history.find((h) => h.checkedAt >= yesterdayStart && h.checkedAt < todayStart);
    const trend = computeTrend(todayRecord || currentRank, yesterdayRecord);
    allKeywordRanks.push({
      keyword: k.keyword, cafeName: k.cafeName, postTitle: k.postTitle,
      groupName: k.groupName, rank: currentRank, yesterdayRank: yesterdayRecord, trend,
      todayClicks: clickMap.get(key) ?? 0,
    });
  }

  const totalKeywords = allKeywordRanks.length;
  const trackedCount = allKeywordRanks.filter((k) => k.rank).length;
  const upCount = allKeywordRanks.filter((k) => k.trend === 'up').length;
  const maintainCount = allKeywordRanks.filter((k) => k.trend === 'maintain').length;
  const downCount = allKeywordRanks.filter((k) => k.trend === 'down').length;
  const outOfRankCount = allKeywordRanks.filter((k) => k.rank && !k.rank.found).length;

  const filteredRanks = allKeywordRanks.filter((k) => {
    if (!filter) return true;
    if (filter === 'tracked') return !!k.rank;
    if (filter === 'outOfRank') return !!k.rank && !k.rank.found;
    return k.trend === filter;
  });

  const grouped: GroupedKeyword[] = [];
  const kwMap = new Map<string, GroupedKeyword>();
  for (const k of filteredRanks) {
    let group = kwMap.get(k.keyword);
    if (!group) { group = { keyword: k.keyword, entries: [] }; kwMap.set(k.keyword, group); grouped.push(group); }
    group.entries.push(k);
  }

  const statCardStyle = (active: boolean, borderColor: string) => ({
    bg: active ? `${borderColor}.50` : 'white',
    borderWidth: active ? '2px' : '1px',
    borderColor: active ? `${borderColor}.400` : 'gray.200',
    borderRadius: 'lg', p: 4, cursor: 'pointer' as const,
    transition: 'all 0.2s', _hover: { borderColor: `${borderColor}.300`, shadow: 'sm' },
  });

  return (
    <Stack spacing={5}>
      <Heading size="md">C랭크 순위</Heading>

      <Box bg="purple.50" borderRadius="md" p={3}>
        <Text fontSize="sm" color="purple.700">워커 PC가 카페 크롤링 시 자동으로 순위와 클릭 수가 기록됩니다.</Text>
      </Box>

      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4} borderLeftWidth="4px" borderLeftColor="teal.400">
          <StatLabel><HStack spacing={1}><Icon as={FiMousePointer} color="teal.500" /><Text>오늘 클릭</Text></HStack></StatLabel>
          <StatNumber color="teal.600">{clickStats.today}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>어제 클릭</StatLabel><StatNumber>{clickStats.yesterday}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>그저께 클릭</StatLabel><StatNumber>{clickStats.dayBefore}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4} borderLeftWidth="4px" borderLeftColor="purple.400">
          <StatLabel>이번주 합계</StatLabel><StatNumber color="purple.600">{clickStats.thisWeek}</StatNumber>
        </Stat>
      </SimpleGrid>

      <Divider />

      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>추적 키워드</StatLabel><StatNumber>{grouped.length}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>전체 항목</StatLabel><StatNumber>{totalKeywords}</StatNumber>
        </Stat>
        <Stat {...statCardStyle(filter === 'tracked', 'green')} onClick={() => toggleFilter('tracked')}>
          <StatLabel>추적됨</StatLabel><StatNumber color="green.500">{trackedCount}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>미진행</StatLabel><StatNumber color="gray.500">{totalKeywords - trackedCount}</StatNumber>
        </Stat>
      </SimpleGrid>

      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <Stat {...statCardStyle(filter === 'up', 'red')} onClick={() => toggleFilter('up')}>
          <StatLabel><HStack spacing={1}><Icon as={FiTrendingUp} color="red.500" /><Text>상승</Text></HStack></StatLabel>
          <StatNumber color="red.500">{upCount}</StatNumber>
        </Stat>
        <Stat {...statCardStyle(filter === 'maintain', 'gray')} onClick={() => toggleFilter('maintain')}>
          <StatLabel><HStack spacing={1}><Icon as={FiMinus} color="gray.500" /><Text>유지</Text></HStack></StatLabel>
          <StatNumber color="gray.500">{maintainCount}</StatNumber>
        </Stat>
        <Stat {...statCardStyle(filter === 'down', 'blue')} onClick={() => toggleFilter('down')}>
          <StatLabel><HStack spacing={1}><Icon as={FiTrendingDown} color="blue.500" /><Text>하락</Text></HStack></StatLabel>
          <StatNumber color="blue.500">{downCount}</StatNumber>
        </Stat>
        <Stat {...statCardStyle(filter === 'outOfRank', 'orange')} onClick={() => toggleFilter('outOfRank')}>
          <StatLabel>순위 밖</StatLabel><StatNumber color="orange.500">{outOfRankCount}</StatNumber>
        </Stat>
      </SimpleGrid>

      {filter && (
        <Flex align="center" gap={2}>
          <Badge colorScheme={filter === 'tracked' ? 'green' : filter === 'up' ? 'red' : filter === 'down' ? 'blue' : filter === 'outOfRank' ? 'orange' : 'gray'} fontSize="sm" px={2} py={1}>
            {filter === 'tracked' ? '추적됨' : filter === 'up' ? '상승' : filter === 'down' ? '하락' : filter === 'outOfRank' ? '순위 밖' : '유지'} 필터 적용 중
          </Badge>
          <Button size="xs" variant="ghost" onClick={() => setFilter(null)}>해제</Button>
        </Flex>
      )}

      {grouped.length > 0 ? grouped.map((g) => (
        <KeywordGroup key={g.keyword} group={g} onShowHistory={showHistory} onShowClickHistory={showClickHistory} />
      )) : (
        <Box borderWidth="1px" borderRadius="lg" p={8} textAlign="center">
          <Text color="gray.500">{filter ? '해당 필터에 맞는 항목이 없습니다.' : '등록된 C랭크 키워드가 없습니다.'}</Text>
        </Box>
      )}

      <Modal isOpen={!!historyModal} onClose={() => setHistoryModal(null)} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            순위 이력 — "{historyModal?.keyword}"
            <Text fontSize="sm" color="gray.500" fontWeight="normal">카페: {historyModal?.cafeName} / {historyModal?.postTitle}</Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            {historyModal?.items && historyModal.items.length > 0 ? (
              <Table size="sm">
                <Thead><Tr><Th>날짜/시간</Th><Th>순위</Th><Th>변동</Th></Tr></Thead>
                <Tbody>
                  {historyModal.items.map((h, idx) => {
                    const prev = historyModal.items[idx + 1];
                    const t = computeTrend(h, prev);
                    return (
                      <Tr key={h.id}>
                        <Td fontSize="sm">{new Date(h.checkedAt).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Td>
                        <Td><CRankBadge rank={h} /></Td>
                        <Td><CRankTrendIndicator trend={t} current={h} previous={prev} /></Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            ) : <Text color="gray.500">이력이 없습니다.</Text>}
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal isOpen={!!clickHistoryModal} onClose={() => setClickHistoryModal(null)} size="md">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            클릭 이력 — "{clickHistoryModal?.keyword}"
            <Text fontSize="sm" color="gray.500" fontWeight="normal">카페: {clickHistoryModal?.cafeName}</Text>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            {clickHistoryModal?.items && clickHistoryModal.items.length > 0 ? (
              <Table size="sm">
                <Thead><Tr><Th>날짜</Th><Th textAlign="right">클릭 수</Th></Tr></Thead>
                <Tbody>
                  {clickHistoryModal.items.map((h) => (
                    <Tr key={h.date}>
                      <Td fontSize="sm">{h.date}</Td>
                      <Td textAlign="right"><Badge colorScheme="teal">{h.count}회</Badge></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : <Text color="gray.500">클릭 이력이 없습니다.</Text>}
          </ModalBody>
        </ModalContent>
      </Modal>
    </Stack>
  );
}
