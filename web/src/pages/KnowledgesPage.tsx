import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Select,
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
  Editable,
  EditableInput,
  EditablePreview,
  Badge,
  Tag,
} from '@chakra-ui/react';
import { FiTrash2, FiPlus } from 'react-icons/fi';
import type { Knowledge, KeywordGroup, Worker, Product, KnowledgeMode } from '@shared/types';
import { api } from '@/api';
import { useRef } from 'react';

export default function KnowledgesPage({ isAdmin = true }: { isAdmin?: boolean }) {
  const [groups, setGroups] = useState<KeywordGroup[]>([]);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [items, setItems] = useState<Knowledge[]>([]);
  const [allKnowledges, setAllKnowledges] = useState<Knowledge[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedWorkerForGroup, setSelectedWorkerForGroup] = useState('');
  const [draft, setDraft] = useState({ keyword: '', itemName: '', productName: '', mode: 'shopping' as KnowledgeMode, siteUrl: '' });
  const [productQuery, setProductQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'group' | 'knowledge'; id: string; label: string } | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const toast = useToast();

  const refreshProducts = useCallback(async () => {
    try {
      const items = await api.products.list();
      setAllProducts(items);
    } catch { /* ignore */ }
  }, []);

  const suggestions = useMemo(() => {
    if (!productQuery.trim()) return [];
    const q = productQuery.toLowerCase();
    return allProducts.filter((p) =>
      p.productName.toLowerCase().includes(q) || p.productNumber.includes(q),
    ).slice(0, 10);
  }, [productQuery, allProducts]);

  function highlightMatch(text: string, query: string) {
    if (!query.trim()) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <Box as="span" bg="yellow.200" px="1px" borderRadius="sm">{text.slice(idx, idx + query.length)}</Box>
        {text.slice(idx + query.length)}
      </>
    );
  }

  const refreshGroups = useCallback(async () => {
    const list = await api.keywordGroups.list();
    setGroups(list);
    return list;
  }, []);

  const refreshKnowledges = useCallback(async () => {
    const all = await api.knowledges.list();
    setAllKnowledges(all);
    if (selectedGroupName) {
      setItems(all.filter((k) => k.groupName === selectedGroupName));
    } else {
      setItems(all);
    }
  }, [selectedGroupName]);

  const refreshWorkers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const w = await api.workers.list();
      setWorkers(w);
    } catch { /* worker API not accessible for non-admin */ }
  }, [isAdmin]);

  useEffect(() => {
    refreshGroups();
    refreshWorkers();
    refreshProducts();
  }, [refreshGroups, refreshWorkers, refreshProducts]);

  useEffect(() => {
    refreshKnowledges();
  }, [refreshKnowledges]);

  const getWorkerForGroup = useCallback((groupName: string): Worker | undefined => {
    return workers.find((w) => w.assignedGroupNames.includes(groupName));
  }, [workers]);

  const productCountByWorker = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of workers) {
      if (w.assignedGroupNames.length === 0) {
        counts.set(w.id, allKnowledges.length);
      } else {
        counts.set(w.id, allKnowledges.filter((k) => k.groupName && w.assignedGroupNames.includes(k.groupName)).length);
      }
    }
    return counts;
  }, [workers, allKnowledges]);

  const productCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) {
      counts.set(g.groupName, allKnowledges.filter((k) => k.groupName === g.groupName).length);
    }
    return counts;
  }, [groups, allKnowledges]);

  const addGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast({ title: '그룹명을 입력해주세요', status: 'warning', position: 'top' });
      return;
    }
    if (groups.some((g) => g.groupName === name)) {
      toast({ title: '이미 존재하는 그룹명입니다', status: 'warning', position: 'top' });
      return;
    }
    await api.keywordGroups.create(name);

    if (selectedWorkerForGroup) {
      const worker = workers.find((w) => w.id === selectedWorkerForGroup);
      if (worker) {
        await api.workers.update(worker.id, {
          assignedGroupNames: [...worker.assignedGroupNames, name],
        });
        await refreshWorkers();
      }
    }

    setNewGroupName('');
    setSelectedWorkerForGroup('');
    const list = await refreshGroups();
    if (!selectedGroupName && list.length > 0) {
      setSelectedGroupName(list[list.length - 1].groupName);
    }
  };

  const renameGroup = async (id: string, newName: string) => {
    const name = newName.trim();
    if (!name) return;
    const old = groups.find((g) => g.id === id);
    if (!old || old.groupName === name) return;
    await api.keywordGroups.update(id, name);
    if (selectedGroupName === old.groupName) {
      setSelectedGroupName(name);
    }
    refreshGroups();
  };

  const confirmDeleteGroup = (g: KeywordGroup) => {
    setDeleteTarget({ type: 'group', id: g.id, label: `그룹 "${g.groupName}"과 소속된 모든 키워드` });
    onOpen();
  };

  const confirmDeleteKnowledge = (k: Knowledge) => {
    setDeleteTarget({ type: 'knowledge', id: k.id, label: `키워드 "${k.keyword}"` });
    onOpen();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'group') {
      const group = groups.find((g) => g.id === deleteTarget.id);
      await api.keywordGroups.remove(deleteTarget.id);
      if (group && selectedGroupName === group.groupName) {
        setSelectedGroupName(null);
      }
      await refreshGroups();
    } else {
      await api.knowledges.remove(deleteTarget.id);
    }
    await refreshKnowledges();
    onClose();
    setDeleteTarget(null);
  };

  const toggleActive = async (k: Knowledge) => {
    const nextActive = !((k.isActive ?? true));
    // 낙관적 업데이트
    setItems((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: nextActive } : x)));
    setAllKnowledges((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: nextActive } : x)));
    try {
      await api.knowledgesActive.set(k.id, nextActive);
      toast({
        title: nextActive ? '활성화됨' : '비활성화됨',
        description: `"${k.keyword}" → 워커가 ${nextActive ? '다음 사이클부터 작업' : '작업하지 않음'}`,
        status: nextActive ? 'success' : 'warning',
        duration: 2000,
        position: 'top',
      });
    } catch (e) {
      // 롤백
      setItems((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: !nextActive } : x)));
      setAllKnowledges((prev) => prev.map((x) => (x.id === k.id ? { ...x, isActive: !nextActive } : x)));
      toast({ title: '변경 실패', description: String((e as Error).message), status: 'error', position: 'top' });
    }
  };

  const addKnowledge = async () => {
    if (!selectedGroupName) {
      toast({ title: '먼저 그룹을 선택해주세요', status: 'warning', position: 'top' });
      return;
    }
    if (draft.mode === 'shopping' && (!draft.keyword || !draft.itemName)) {
      toast({ title: '키워드와 상품번호는 필수입니다', status: 'warning', position: 'top' });
      return;
    }
    if (draft.mode === 'blog' && (!draft.keyword || !draft.siteUrl)) {
      toast({ title: '키워드와 사이트 URL/제목은 필수입니다', status: 'warning', position: 'top' });
      return;
    }
    await api.knowledges.upsert({
      keyword: draft.keyword.trim(),
      itemName: draft.mode === 'blog' ? (draft.siteUrl.trim()) : draft.itemName.trim(),
      purchaseName: draft.mode === 'shopping' ? (draft.productName.trim() || productQuery.trim() || undefined) : undefined,
      groupName: selectedGroupName,
      mode: draft.mode,
      siteUrl: draft.mode === 'blog' ? draft.siteUrl.trim() : undefined,
    });
    setDraft({ keyword: '', itemName: '', productName: '', mode: draft.mode, siteUrl: '' });
    setProductQuery('');
    refreshKnowledges();
  };

  return (
    <Stack spacing={5}>
      <Heading size="md">키워드 / 상품</Heading>

      <Flex gap={4} align="stretch" minH="500px">
        {/* ── 왼쪽: 그룹 패널 ── */}
        <Box w="300px" flexShrink={0} borderWidth="1px" borderRadius="lg" p={3}>
          <Text fontWeight="bold" mb={3} fontSize="sm" color="gray.600">
            그룹 목록
          </Text>
          {isAdmin && (
            <Stack spacing={2} mb={3}>
              <Input
                size="sm"
                placeholder="새 그룹명"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              />
              <Select
                size="sm"
                placeholder="배정 워커 PC 선택 (선택사항)"
                value={selectedWorkerForGroup}
                onChange={(e) => setSelectedWorkerForGroup(e.target.value)}
              >
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} — {productCountByWorker.get(w.id) ?? 0}개 상품 배정중
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                colorScheme="blue"
                leftIcon={<FiPlus />}
                onClick={addGroup}
                isDisabled={!newGroupName.trim()}
              >
                그룹 추가
              </Button>
            </Stack>
          )}

          <Stack spacing={1}>
            {groups.map((g) => {
              const assignedWorker = getWorkerForGroup(g.groupName);
              const pCount = productCountByGroup.get(g.groupName) ?? 0;
              return (
                <Box
                  key={g.id}
                  px={2}
                  py={2}
                  borderRadius="md"
                  cursor="pointer"
                  bg={selectedGroupName === g.groupName ? 'blue.50' : 'transparent'}
                  borderWidth={selectedGroupName === g.groupName ? '1px' : '0'}
                  borderColor="blue.300"
                  _hover={{ bg: selectedGroupName === g.groupName ? 'blue.50' : 'gray.50' }}
                  onClick={() => setSelectedGroupName(g.groupName)}
                >
                  <HStack>
                    <Editable
                      flex={1}
                      defaultValue={g.groupName}
                      onSubmit={(val) => renameGroup(g.id, val)}
                      fontSize="sm"
                    >
                      <EditablePreview w="full" />
                      <EditableInput />
                    </Editable>
                    {isAdmin && (
                      <IconButton
                        aria-label="그룹 삭제"
                        icon={<FiTrash2 />}
                        size="xs"
                        variant="ghost"
                        colorScheme="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDeleteGroup(g);
                        }}
                      />
                    )}
                  </HStack>
                  <HStack mt={1} spacing={2}>
                    <Badge fontSize="2xs" colorScheme="gray">{pCount}개 상품</Badge>
                    {isAdmin && assignedWorker && (
                      <Tag size="sm" colorScheme="teal" fontSize="2xs">
                        {assignedWorker.name}
                      </Tag>
                    )}
                    {isAdmin && !assignedWorker && (
                      <Tag size="sm" colorScheme="gray" fontSize="2xs" variant="outline">
                        미배정
                      </Tag>
                    )}
                  </HStack>
                </Box>
              );
            })}
            {groups.length === 0 && (
              <Text fontSize="sm" color="gray.400" textAlign="center" py={4}>
                그룹을 추가해주세요
              </Text>
            )}
          </Stack>
        </Box>

        {/* ── 오른쪽: 키워드/상품 목록 ── */}
        <Box flex={1} borderWidth="1px" borderRadius="lg" p={4}>
          {selectedGroupName ? (
            <>
              <Flex justify="space-between" align="center" mb={4}>
                <HStack>
                  <Text fontWeight="bold" fontSize="md">
                    {selectedGroupName}
                  </Text>
                  {isAdmin && (() => {
                    const w = getWorkerForGroup(selectedGroupName);
                    return w ? (
                      <Tag size="sm" colorScheme="teal">{w.name}</Tag>
                    ) : (
                      <Tag size="sm" colorScheme="gray" variant="outline">미배정</Tag>
                    );
                  })()}
                </HStack>
                <Text fontSize="sm" color="gray.500">
                  {items.length}개 항목
                </Text>
              </Flex>

              <Box mb={4}>
                <HStack spacing={2} mb={2}>
                  <Select
                    w="140px"
                    size="sm"
                    value={draft.mode}
                    onChange={(e) => setDraft({ ...draft, mode: e.target.value as KnowledgeMode })}
                  >
                    <option value="shopping">쇼핑 모드</option>
                    <option value="blog">블로그 모드</option>
                  </Select>
                </HStack>
                <HStack spacing={2}>
                  <Input
                    flex={1}
                    placeholder="키워드"
                    value={draft.keyword}
                    onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && addKnowledge()}
                  />
                  {draft.mode === 'shopping' ? (
                    <>
                      <Box position="relative" flex={1.5} minW="200px">
                        <Input
                          placeholder="상품명 검색 (자동완성)"
                          value={productQuery}
                          onChange={(e) => { setProductQuery(e.target.value); setShowSuggestions(true); }}
                          onFocus={() => setShowSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        />
                        {showSuggestions && suggestions.length > 0 && (
                          <Box position="absolute" top="100%" left={0} right={0} zIndex={20} bg="white" borderWidth="1px" borderRadius="md" shadow="lg" maxH="200px" overflowY="auto">
                            {suggestions.map((p) => (
                              <Box
                                key={p.id}
                                px={3}
                                py={2}
                                cursor="pointer"
                                _hover={{ bg: 'blue.50' }}
                                onClick={() => {
                                  setDraft({ ...draft, itemName: p.productNumber, productName: p.productName });
                                  setProductQuery(p.productName);
                                  setShowSuggestions(false);
                                }}
                              >
                                <Text fontSize="sm">
                                  {highlightMatch(p.productName, productQuery)}{' '}
                                  <Text as="span" color="gray.400">({highlightMatch(p.productNumber, productQuery)})</Text>
                                </Text>
                              </Box>
                            ))}
                          </Box>
                        )}
                      </Box>
                      <Input
                        flex={1}
                        placeholder="상품번호"
                        value={draft.itemName}
                        onChange={(e) => setDraft({ ...draft, itemName: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && addKnowledge()}
                      />
                    </>
                  ) : (
                    <Input
                      flex={2}
                      placeholder="사이트 URL 또는 제목 일부 (매칭용)"
                      value={draft.siteUrl}
                      onChange={(e) => setDraft({ ...draft, siteUrl: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && addKnowledge()}
                    />
                  )}
                  <Button onClick={addKnowledge} colorScheme="blue" px={6} flexShrink={0}>
                    추가
                  </Button>
                </HStack>
              </Box>

              {items.some((k) => !(k.isActive ?? true)) && (
                <Flex justify="flex-end" mb={2}>
                  <Button
                    size="xs"
                    colorScheme="green"
                    variant="outline"
                    onClick={async () => {
                      if (!selectedGroupName) return;
                      try {
                        const result = await api.knowledgesActive.setGroup(selectedGroupName, true);
                        setItems((prev) => prev.map((x) => ({ ...x, isActive: true })));
                        setAllKnowledges((prev) => prev.map((x) => x.groupName === selectedGroupName ? { ...x, isActive: true } : x));
                        toast({ title: `${result.updated}개 키워드 활성화됨`, status: 'success', duration: 2000, position: 'top' });
                      } catch (e) {
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
                      <Th w="70px" textAlign="center">활성</Th>
                      <Th w="70px" textAlign="center">모드</Th>
                      <Th>키워드</Th>
                      <Th>상품명/사이트</Th>
                      <Th>상품번호/URL</Th>
                      <Th>등록일</Th>
                      <Th w="40px"></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {items.map((k) => {
                      const active = k.isActive ?? true;
                      const isBlog = (k.mode ?? 'shopping') === 'blog';
                      return (
                        <Tr key={k.id} bg={active ? undefined : 'gray.50'} opacity={active ? 1 : 0.65}>
                          <Td textAlign="center">
                            <Tooltip
                              label={active ? '클릭하면 OFF (워커가 작업하지 않음)' : '클릭하면 ON (워커가 다음 사이클부터 작업)'}
                              hasArrow
                            >
                              <Switch
                                size="sm"
                                colorScheme="green"
                                isChecked={active}
                                onChange={() => toggleActive(k)}
                              />
                            </Tooltip>
                          </Td>
                          <Td textAlign="center">
                            <Badge colorScheme={isBlog ? 'purple' : 'green'} fontSize="2xs">
                              {isBlog ? '블로그' : '쇼핑'}
                            </Badge>
                          </Td>
                          <Td>
                            <HStack spacing={2}>
                              <Text textDecoration={active ? 'none' : 'line-through'}>{k.keyword}</Text>
                              {!active && <Badge colorScheme="red" fontSize="2xs">OFF</Badge>}
                            </HStack>
                          </Td>
                          <Td>{isBlog ? (k.siteUrl || k.itemName) : (k.purchaseName || '-')}</Td>
                          <Td>{isBlog ? '-' : k.itemName}</Td>
                          <Td>{new Date(k.createdAt).toLocaleDateString()}</Td>
                          <Td isNumeric>
                            <IconButton
                              aria-label="삭제"
                              size="sm"
                              variant="ghost"
                              colorScheme="red"
                              icon={<FiTrash2 />}
                              onClick={() => confirmDeleteKnowledge(k)}
                            />
                          </Td>
                        </Tr>
                      );
                    })}
                    {items.length === 0 && (
                      <Tr>
                        <Td colSpan={7} textAlign="center" color="gray.500" py={6}>
                          이 그룹에 등록된 항목이 없습니다.
                        </Td>
                      </Tr>
                    )}
                  </Tbody>
                </Table>
              </Box>
            </>
          ) : (
            <Flex h="full" align="center" justify="center">
              <Text color="gray.400" fontSize="lg">
                {groups.length > 0
                  ? '왼쪽에서 그룹을 선택해주세요'
                  : '먼저 그룹을 추가해주세요'}
              </Text>
            </Flex>
          )}
        </Box>
      </Flex>

      {/* ── 삭제 확인 다이얼로그 ── */}
      <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef as any} onClose={onClose}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              삭제 확인
            </AlertDialogHeader>
            <AlertDialogBody>
              {deleteTarget?.label}을(를) 삭제하시겠습니까?
              {deleteTarget?.type === 'group' && (
                <Text mt={2} color="red.500" fontSize="sm">
                  그룹 삭제 시 소속된 모든 키워드도 함께 삭제됩니다.
                </Text>
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef as any} onClick={onClose}>
                취소
              </Button>
              <Button colorScheme="red" onClick={handleDelete} ml={3}>
                삭제
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Stack>
  );
}
