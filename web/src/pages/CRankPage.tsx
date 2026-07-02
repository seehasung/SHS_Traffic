import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Stack,
  Switch,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  useToast,
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  useDisclosure,
  Badge,
} from '@chakra-ui/react';
import { FiTrash2, FiPlus } from 'react-icons/fi';
import type { CRankGroup, CRankKnowledge, CafeEntry } from '@shared/types';
import { api } from '@/api';

function SearchableDropdown({
  placeholder,
  items,
  value,
  onChange,
  renderItem,
}: {
  placeholder: string;
  items: string[];
  value: string;
  onChange: (v: string) => void;
  renderItem?: (item: string, query: string) => React.ReactNode;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.toLowerCase().includes(q));
  }, [items, query]);

  function highlight(text: string, q: string) {
    if (!q.trim()) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <Box as="span" bg="yellow.200" px="1px" borderRadius="sm">{text.slice(idx, idx + q.length)}</Box>
        {text.slice(idx + q.length)}
      </>
    );
  }

  return (
    <Box position="relative" flex={1}>
      <Input
        size="sm"
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange(''); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && filtered.length > 0 && (
        <Box position="absolute" top="100%" left={0} right={0} zIndex={20} bg="white" borderWidth="1px" borderRadius="md" shadow="lg" maxH="200px" overflowY="auto">
          {filtered.map((item) => (
            <Box
              key={item}
              px={3}
              py={2}
              cursor="pointer"
              _hover={{ bg: 'blue.50' }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(item);
                setQuery(item);
                setOpen(false);
              }}
            >
              <Text fontSize="sm">{renderItem ? renderItem(item, query) : highlight(item, query)}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function CRankPage() {
  const [groups, setGroups] = useState<CRankGroup[]>([]);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [items, setItems] = useState<CRankKnowledge[]>([]);
  const [allItems, setAllItems] = useState<CRankKnowledge[]>([]);
  const [cafeEntries, setCafeEntries] = useState<CafeEntry[]>([]);
  const [newGroupName, setNewGroupName] = useState('');

  // 연쇄 드롭박스
  const [selCafe, setSelCafe] = useState('');
  const [selKeyword, setSelKeyword] = useState('');
  const [selTitle, setSelTitle] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'group' | 'knowledge'; id: string; label: string } | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const toast = useToast();

  const refreshGroups = useCallback(async () => {
    const list = await api.crankGroups.list();
    setGroups(list);
    return list;
  }, []);

  const refreshKnowledges = useCallback(async () => {
    const all = await api.crankKnowledges.list();
    setAllItems(all);
    if (selectedGroupName) {
      setItems(all.filter((k) => k.groupName === selectedGroupName));
    } else {
      setItems(all);
    }
  }, [selectedGroupName]);

  const refreshCafes = useCallback(async () => {
    const list = await api.cafeEntries.list();
    setCafeEntries(list);
  }, []);

  useEffect(() => { refreshGroups(); refreshCafes(); }, [refreshGroups, refreshCafes]);
  useEffect(() => { refreshKnowledges(); }, [refreshKnowledges]);

  const cafeNames = useMemo(() => [...new Set(cafeEntries.map((e) => e.cafeName))].sort(), [cafeEntries]);

  const keywordsForCafe = useMemo(() => {
    if (!selCafe) return [];
    return [...new Set(cafeEntries.filter((e) => e.cafeName === selCafe).map((e) => e.targetKeyword))].sort();
  }, [cafeEntries, selCafe]);

  const titlesForKeyword = useMemo(() => {
    if (!selCafe || !selKeyword) return [];
    return [...new Set(cafeEntries.filter((e) => e.cafeName === selCafe && e.targetKeyword === selKeyword).map((e) => e.postTitle))].sort();
  }, [cafeEntries, selCafe, selKeyword]);

  const countByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) m.set(g.groupName, allItems.filter((k) => k.groupName === g.groupName).length);
    return m;
  }, [groups, allItems]);

  const addGroup = async () => {
    const name = newGroupName.trim();
    if (!name) { toast({ title: '그룹명을 입력해주세요', status: 'warning', position: 'top' }); return; }
    if (groups.some((g) => g.groupName === name)) { toast({ title: '이미 존재하는 그룹명입니다', status: 'warning', position: 'top' }); return; }
    await api.crankGroups.create(name);
    setNewGroupName('');
    const list = await refreshGroups();
    if (!selectedGroupName && list.length > 0) setSelectedGroupName(list[list.length - 1].groupName);
  };

  const confirmDeleteGroup = (g: CRankGroup) => {
    setDeleteTarget({ type: 'group', id: g.id, label: `그룹 "${g.groupName}"과 소속된 모든 키워드` });
    onOpen();
  };

  const confirmDeleteKnowledge = (k: CRankKnowledge) => {
    setDeleteTarget({ type: 'knowledge', id: k.id, label: `"${k.keyword} / ${k.cafeName} / ${k.postTitle}"` });
    onOpen();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'group') {
      const group = groups.find((g) => g.id === deleteTarget.id);
      await api.crankGroups.remove(deleteTarget.id);
      if (group && selectedGroupName === group.groupName) setSelectedGroupName(null);
      await refreshGroups();
    } else {
      await api.crankKnowledges.remove(deleteTarget.id);
    }
    await refreshKnowledges();
    onClose();
    setDeleteTarget(null);
  };

  const toggleActive = async (k: CRankKnowledge) => {
    const nextActive = !k.isActive;
    setItems((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: nextActive } : x)));
    setAllItems((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: nextActive } : x)));
    try {
      await api.crankKnowledges.setActive(k.id, nextActive);
    } catch {
      setItems((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: !nextActive } : x)));
      setAllItems((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: !nextActive } : x)));
    }
  };

  const addKnowledge = async () => {
    if (!selectedGroupName) { toast({ title: '먼저 그룹을 선택해주세요', status: 'warning', position: 'top' }); return; }
    if (!selCafe || !selKeyword || !selTitle) {
      toast({ title: '카페명, 타겟 키워드, 글 제목을 모두 선택해주세요', status: 'warning', position: 'top' }); return;
    }
    try {
      await api.crankKnowledges.create({ keyword: selKeyword, cafeName: selCafe, postTitle: selTitle, groupName: selectedGroupName });
      setSelCafe(''); setSelKeyword(''); setSelTitle('');
      refreshKnowledges();
      toast({ title: '추가되었습니다', status: 'success', position: 'top', duration: 2000 });
    } catch (e: any) {
      toast({ title: e?.message ?? '추가 실패', status: 'error', position: 'top' });
    }
  };

  return (
    <Stack spacing={5}>
      <Heading size="md">C랭크</Heading>
      <Flex gap={4} align="stretch" minH="500px">
        {/* 왼쪽: 그룹 패널 */}
        <Box w="260px" flexShrink={0} borderWidth="1px" borderRadius="lg" p={3}>
          <Text fontWeight="bold" mb={3} fontSize="sm" color="gray.600">그룹 목록</Text>
          <Stack spacing={2} mb={3}>
            <Input size="sm" placeholder="새 그룹명" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addGroup()} />
            <Button size="sm" colorScheme="blue" leftIcon={<FiPlus />} onClick={addGroup} isDisabled={!newGroupName.trim()}>그룹 추가</Button>
          </Stack>
          <Stack spacing={1}>
            {groups.map((g) => (
              <Box
                key={g.id}
                px={2} py={2} borderRadius="md" cursor="pointer"
                bg={selectedGroupName === g.groupName ? 'blue.50' : 'transparent'}
                borderWidth={selectedGroupName === g.groupName ? '1px' : '0'}
                borderColor="blue.300"
                _hover={{ bg: selectedGroupName === g.groupName ? 'blue.50' : 'gray.50' }}
                onClick={() => setSelectedGroupName(g.groupName)}
              >
                <HStack>
                  <Text flex={1} fontSize="sm">{g.groupName}</Text>
                  <IconButton aria-label="그룹 삭제" icon={<FiTrash2 />} size="xs" variant="ghost" colorScheme="red" onClick={(e) => { e.stopPropagation(); confirmDeleteGroup(g); }} />
                </HStack>
                <Badge fontSize="2xs" colorScheme="gray" mt={1}>{countByGroup.get(g.groupName) ?? 0}개 항목</Badge>
              </Box>
            ))}
            {groups.length === 0 && <Text fontSize="sm" color="gray.400" textAlign="center" py={4}>그룹을 추가해주세요</Text>}
          </Stack>
        </Box>

        {/* 오른쪽: C랭크 키워드 목록 */}
        <Box flex={1} borderWidth="1px" borderRadius="lg" p={4}>
          {selectedGroupName ? (
            <>
              <Flex justify="space-between" align="center" mb={4}>
                <Text fontWeight="bold" fontSize="md">{selectedGroupName}</Text>
                <Text fontSize="sm" color="gray.500">{items.length}개 항목</Text>
              </Flex>

              {/* 연쇄 드롭박스 */}
              <Box mb={4} p={3} bg="gray.50" borderRadius="md">
                <HStack spacing={2} mb={2}>
                  <SearchableDropdown placeholder="카페명 선택" items={cafeNames} value={selCafe} onChange={(v) => { setSelCafe(v); setSelKeyword(''); setSelTitle(''); }} />
                  <SearchableDropdown placeholder="타겟 키워드 선택" items={keywordsForCafe} value={selKeyword} onChange={(v) => { setSelKeyword(v); setSelTitle(''); }} />
                  <SearchableDropdown placeholder="글 제목 선택" items={titlesForKeyword} value={selTitle} onChange={(v) => setSelTitle(v)} />
                  <Button size="sm" colorScheme="blue" onClick={addKnowledge} flexShrink={0} isDisabled={!selCafe || !selKeyword || !selTitle}>추가</Button>
                </HStack>
                <Text fontSize="xs" color="gray.500">카페 관리에서 등록한 카페/키워드/제목이 연쇄 드롭다운으로 나타납니다.</Text>
              </Box>

              {items.some((k) => !k.isActive) && (
                <Flex justify="flex-end" mb={2}>
                  <Button
                    size="xs" colorScheme="green" variant="outline"
                    onClick={async () => {
                      if (!selectedGroupName) return;
                      try {
                        await api.crankKnowledges.setGroupActive(selectedGroupName, true);
                        setItems((prev) => prev.map((x) => ({ ...x, isActive: true })));
                        setAllItems((prev) => prev.map((x) => x.groupName === selectedGroupName ? { ...x, isActive: true } : x));
                        toast({ title: '모든 키워드 활성화됨', status: 'success', duration: 2000, position: 'top' });
                      } catch {
                        toast({ title: '일괄 활성화 실패', status: 'error', position: 'top' });
                      }
                    }}
                  >
                    이 그룹 모두 켜기
                  </Button>
                </Flex>
              )}

              <Box borderWidth="1px" borderRadius="md" overflow="hidden">
                <Table size="sm">
                  <Thead bg="gray.50">
                    <Tr>
                      <Th w="60px" textAlign="center">활성</Th>
                      <Th>타겟 키워드</Th>
                      <Th>카페명</Th>
                      <Th>글 제목</Th>
                      <Th>등록일</Th>
                      <Th w="40px"></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {items.map((k) => (
                      <Tr key={k.id} bg={k.isActive ? undefined : 'gray.50'} opacity={k.isActive ? 1 : 0.65}>
                        <Td textAlign="center">
                          <Tooltip label={k.isActive ? 'OFF로 전환' : 'ON으로 전환'} hasArrow>
                            <Switch size="sm" colorScheme="green" isChecked={k.isActive} onChange={() => toggleActive(k)} />
                          </Tooltip>
                        </Td>
                        <Td>
                          <HStack spacing={2}>
                            <Text textDecoration={k.isActive ? 'none' : 'line-through'}>{k.keyword}</Text>
                            {!k.isActive && <Badge colorScheme="red" fontSize="2xs">OFF</Badge>}
                          </HStack>
                        </Td>
                        <Td>{k.cafeName}</Td>
                        <Td>{k.postTitle}</Td>
                        <Td>{new Date(k.createdAt).toLocaleDateString()}</Td>
                        <Td>
                          <IconButton aria-label="삭제" size="sm" variant="ghost" colorScheme="red" icon={<FiTrash2 />} onClick={() => confirmDeleteKnowledge(k)} />
                        </Td>
                      </Tr>
                    ))}
                    {items.length === 0 && (
                      <Tr><Td colSpan={6} textAlign="center" color="gray.500" py={6}>이 그룹에 등록된 항목이 없습니다.</Td></Tr>
                    )}
                  </Tbody>
                </Table>
              </Box>
            </>
          ) : (
            <Flex h="full" align="center" justify="center">
              <Text color="gray.400" fontSize="lg">{groups.length > 0 ? '왼쪽에서 그룹을 선택해주세요' : '먼저 그룹을 추가해주세요'}</Text>
            </Flex>
          )}
        </Box>
      </Flex>

      <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef as any} onClose={onClose}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">삭제 확인</AlertDialogHeader>
            <AlertDialogBody>
              {deleteTarget?.label}을(를) 삭제하시겠습니까?
              {deleteTarget?.type === 'group' && (
                <Text mt={2} color="red.500" fontSize="sm">그룹 삭제 시 소속된 모든 키워드도 함께 삭제됩니다.</Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef as any} onClick={onClose}>취소</Button>
              <Button colorScheme="red" onClick={handleDelete} ml={3}>삭제</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Stack>
  );
}
