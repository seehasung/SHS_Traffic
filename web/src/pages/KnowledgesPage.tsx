import { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
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
} from '@chakra-ui/react';
import { FiTrash2, FiPlus } from 'react-icons/fi';
import type { Knowledge, KeywordGroup } from '@shared/types';
import { api } from '@/api';
import { useRef } from 'react';

export default function KnowledgesPage({ isAdmin = true }: { isAdmin?: boolean }) {
  const [groups, setGroups] = useState<KeywordGroup[]>([]);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [items, setItems] = useState<Knowledge[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [draft, setDraft] = useState({ keyword: '', itemName: '' });
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'group' | 'knowledge'; id: string; label: string } | null>(null);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const toast = useToast();

  const refreshGroups = useCallback(async () => {
    const list = await api.keywordGroups.list();
    setGroups(list);
    return list;
  }, []);

  const refreshKnowledges = useCallback(async () => {
    const all = await api.knowledges.list();
    if (selectedGroupName) {
      setItems(all.filter((k) => k.groupName === selectedGroupName));
    } else {
      setItems(all);
    }
  }, [selectedGroupName]);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  useEffect(() => {
    refreshKnowledges();
  }, [refreshKnowledges]);

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
    setNewGroupName('');
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

  const addKnowledge = async () => {
    if (!selectedGroupName) {
      toast({ title: '먼저 그룹을 선택해주세요', status: 'warning', position: 'top' });
      return;
    }
    if (!draft.keyword || !draft.itemName) {
      toast({ title: '키워드와 상품번호는 필수입니다', status: 'warning', position: 'top' });
      return;
    }
    await api.knowledges.upsert({
      keyword: draft.keyword.trim(),
      itemName: draft.itemName.trim(),
      groupName: selectedGroupName,
    });
    setDraft({ keyword: '', itemName: '' });
    refreshKnowledges();
  };

  return (
    <Stack spacing={5}>
      <Heading size="md">키워드 / 상품</Heading>

      <Flex gap={4} align="stretch" minH="500px">
        {/* ── 왼쪽: 그룹 패널 ── */}
        <Box w="240px" flexShrink={0} borderWidth="1px" borderRadius="lg" p={3}>
          <Text fontWeight="bold" mb={3} fontSize="sm" color="gray.600">
            그룹 목록
          </Text>
          {isAdmin && (
            <HStack mb={3}>
              <Input
                size="sm"
                placeholder="새 그룹명"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              />
              <IconButton
                aria-label="그룹 추가"
                icon={<FiPlus />}
                size="sm"
                colorScheme="blue"
                onClick={addGroup}
              />
            </HStack>
          )}

          <Stack spacing={1}>
            {groups.map((g) => (
              <HStack
                key={g.id}
                px={2}
                py={1.5}
                borderRadius="md"
                cursor="pointer"
                bg={selectedGroupName === g.groupName ? 'blue.50' : 'transparent'}
                borderWidth={selectedGroupName === g.groupName ? '1px' : '0'}
                borderColor="blue.300"
                _hover={{ bg: selectedGroupName === g.groupName ? 'blue.50' : 'gray.50' }}
                onClick={() => setSelectedGroupName(g.groupName)}
              >
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
            ))}
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
                <Text fontWeight="bold" fontSize="md">
                  {selectedGroupName}
                </Text>
                <Text fontSize="sm" color="gray.500">
                  {items.length}개 항목
                </Text>
              </Flex>

              <Box mb={4}>
                <HStack>
                  <Input
                    placeholder="키워드"
                    value={draft.keyword}
                    onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && addKnowledge()}
                  />
                  <Input
                    placeholder="상품번호 (data-shp-contents-id)"
                    value={draft.itemName}
                    onChange={(e) => setDraft({ ...draft, itemName: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && addKnowledge()}
                  />
                  <Button onClick={addKnowledge} colorScheme="blue" px={6} flexShrink={0}>
                    추가
                  </Button>
                </HStack>
              </Box>

              <Box borderWidth="1px" borderRadius="md" overflow="hidden">
                <Table size="sm">
                  <Thead bg="gray.50">
                    <Tr>
                      <Th>키워드</Th>
                      <Th>상품번호</Th>
                      <Th>등록일</Th>
                      <Th w="40px"></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {items.map((k) => (
                      <Tr key={k.id}>
                        <Td>{k.keyword}</Td>
                        <Td>{k.itemName}</Td>
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
                    ))}
                    {items.length === 0 && (
                      <Tr>
                        <Td colSpan={4} textAlign="center" color="gray.500" py={6}>
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
