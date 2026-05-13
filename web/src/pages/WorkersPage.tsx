import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Button,
  Badge,
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
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  FormControl,
  FormLabel,
  Progress,
  Checkbox,
  CheckboxGroup,
  Stat,
  StatLabel,
  StatNumber,
  SimpleGrid,
} from '@chakra-ui/react';
import { FiTrash2, FiPlus, FiPlay, FiSquare, FiEdit2 } from 'react-icons/fi';
import type { Worker, WorkerStatus, KeywordGroup, Knowledge } from '@shared/types';
import { api } from '@/api';

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [statuses, setStatuses] = useState<WorkerStatus[]>([]);
  const [groups, setGroups] = useState<KeywordGroup[]>([]);
  const [allKnowledges, setAllKnowledges] = useState<Knowledge[]>([]);
  const { isOpen: isAddOpen, onOpen: onAddOpen, onClose: onAddClose } = useDisclosure();
  const { isOpen: isEditOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();
  const [addForm, setAddForm] = useState({ name: '', loginId: '', loginPassword: '' });
  const [editWorker, setEditWorker] = useState<Worker | null>(null);
  const [editForm, setEditForm] = useState({ name: '', loginId: '', loginPassword: '', assignedGroupNames: [] as string[] });
  const toast = useToast();
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const refresh = useCallback(async () => {
    const [w, s, g, k] = await Promise.all([
      api.workers.list(),
      api.workers.statuses(),
      api.keywordGroups.list(),
      api.knowledges.list(),
    ]);
    setWorkers(w);
    setStatuses(s);
    setGroups(g);
    setAllKnowledges(k);
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(() => {
      api.workers.statuses().then(setStatuses).catch(() => {});
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  const getStatus = (workerId: string): WorkerStatus | undefined =>
    statuses.find((s) => s.workerId === workerId);

  const workerStats = useMemo(() => {
    const result = new Map<string, { groupCount: number; productCount: number; keywordCount: number }>();
    for (const w of workers) {
      if (w.assignedGroupNames.length === 0) {
        result.set(w.id, { groupCount: 0, productCount: 0, keywordCount: 0 });
      } else {
        const productIds = new Set<string>();
        let keywordCount = 0;
        for (const k of allKnowledges) {
          if (k.groupName && w.assignedGroupNames.includes(k.groupName)) {
            productIds.add(k.itemName);
            keywordCount++;
          }
        }
        result.set(w.id, { groupCount: w.assignedGroupNames.length, productCount: productIds.size, keywordCount });
      }
    }
    return result;
  }, [workers, groups, allKnowledges]);

  const handleAdd = async () => {
    if (!addForm.name || !addForm.loginId || !addForm.loginPassword) {
      toast({ title: '모든 필드를 입력해주세요', status: 'warning', position: 'top' });
      return;
    }
    try {
      await api.workers.create(addForm);
      setAddForm({ name: '', loginId: '', loginPassword: '' });
      onAddClose();
      refresh();
      toast({ title: '워커가 추가되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? '추가 실패', status: 'error', position: 'top' });
    }
  };

  const openEdit = (w: Worker) => {
    setEditWorker(w);
    setEditForm({
      name: w.name,
      loginId: w.loginId,
      loginPassword: w.loginPassword,
      assignedGroupNames: w.assignedGroupNames,
    });
    onEditOpen();
  };

  const handleEdit = async () => {
    if (!editWorker) return;
    try {
      await api.workers.update(editWorker.id, editForm);
      onEditClose();
      refresh();
      toast({ title: '수정되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? '수정 실패', status: 'error', position: 'top' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 워커를 삭제하시겠습니까?')) return;
    await api.workers.remove(id);
    refresh();
  };

  const handleStart = async (id: string) => {
    try {
      await api.workers.start(id);
      toast({ title: '시작 명령을 전송했습니다', status: 'info', position: 'top' });
    } catch {
      toast({ title: '워커가 오프라인입니다', status: 'error', position: 'top' });
    }
  };

  const handleStop = async (id: string) => {
    try {
      await api.workers.stop(id);
      toast({ title: '중지 명령을 전송했습니다', status: 'info', position: 'top' });
    } catch {
      toast({ title: '워커가 오프라인입니다', status: 'error', position: 'top' });
    }
  };

  const productCountForEditWorkerGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) {
      counts.set(g.groupName, allKnowledges.filter((k) => k.groupName === g.groupName).length);
    }
    return counts;
  }, [groups, allKnowledges]);

  const onlineCount = statuses.filter((s) => s.connectionStatus === 'online').length;
  const runningCount = statuses.filter((s) => s.runnerStatus === 'running').length;

  return (
    <Stack spacing={5}>
      <Flex justify="space-between" align="center">
        <Heading size="md">워커 PC 관리</Heading>
        <Button leftIcon={<FiPlus />} colorScheme="blue" onClick={onAddOpen}>
          워커 추가
        </Button>
      </Flex>

      {/* 요약 통계 */}
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>전체 워커</StatLabel>
          <StatNumber>{workers.length}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>온라인</StatLabel>
          <StatNumber color="green.500">{onlineCount}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>작업 중</StatLabel>
          <StatNumber color="blue.500">{runningCount}</StatNumber>
        </Stat>
        <Stat bg="white" borderWidth="1px" borderRadius="lg" p={4}>
          <StatLabel>오프라인</StatLabel>
          <StatNumber color="gray.400">{workers.length - onlineCount}</StatNumber>
        </Stat>
      </SimpleGrid>

      {/* 워커 목록 */}
      <Box borderWidth="1px" borderRadius="lg" overflow="auto">
        <Table size="sm">
          <Thead bg="gray.50">
            <Tr>
              <Th>이름</Th>
              <Th>로그인 ID</Th>
              <Th>상태</Th>
              <Th>IP 주소</Th>
              <Th>CPU</Th>
              <Th>RAM</Th>
              <Th>현재 작업</Th>
              <Th>배정 그룹</Th>
              <Th>그룹 수</Th>
              <Th>상품 수</Th>
              <Th>키워드 수</Th>
              <Th>진행</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {workers.map((w) => {
              const st = getStatus(w.id);
              const isOnline = st?.connectionStatus === 'online';
              const isRunning = st?.runnerStatus === 'running';
              const stats = workerStats.get(w.id);
              return (
                <Tr key={w.id}>
                  <Td fontWeight="medium">{w.name}</Td>
                  <Td fontSize="sm" color="gray.600">{w.loginId}</Td>
                  <Td>
                    <Badge colorScheme={isOnline ? (isRunning ? 'blue' : 'green') : 'gray'}>
                      {isOnline ? (isRunning ? '작업 중' : '대기') : '오프라인'}
                    </Badge>
                  </Td>
                  <Td fontSize="sm">{st?.ipAddress ?? '-'}</Td>
                  <Td>
                    {st?.cpuUsage != null ? (
                      <HStack spacing={1}>
                        <Progress value={st.cpuUsage} size="xs" w="40px" colorScheme={st.cpuUsage > 80 ? 'red' : 'green'} />
                        <Text fontSize="xs">{Math.round(st.cpuUsage)}%</Text>
                      </HStack>
                    ) : '-'}
                  </Td>
                  <Td>
                    {st?.ramUsage != null ? (
                      <HStack spacing={1}>
                        <Progress value={st.ramUsage} size="xs" w="40px" colorScheme={st.ramUsage > 80 ? 'red' : 'blue'} />
                        <Text fontSize="xs">{Math.round(st.ramUsage)}%</Text>
                      </HStack>
                    ) : '-'}
                  </Td>
                  <Td fontSize="sm" maxW="200px" isTruncated>
                    {st?.currentKeyword ? `${st.currentKeyword}` : '-'}
                    {st?.currentProductId ? ` / ${st.currentProductId}` : ''}
                  </Td>
                  <Td fontSize="xs" maxW="150px">
                    {w.assignedGroupNames.length > 0
                      ? w.assignedGroupNames.join(', ')
                      : <Text color="gray.400">전체</Text>}
                  </Td>
                  <Td fontWeight="medium" textAlign="center">
                    <Badge colorScheme="purple">{stats?.groupCount ?? 0}</Badge>
                  </Td>
                  <Td fontWeight="medium" textAlign="center">
                    <Badge colorScheme="blue">{stats?.productCount ?? 0}</Badge>
                  </Td>
                  <Td fontWeight="medium" textAlign="center">
                    <Badge colorScheme="orange">{stats?.keywordCount ?? 0}</Badge>
                  </Td>
                  <Td>{st?.progressCount ?? 0}</Td>
                  <Td>
                    <HStack spacing={1}>
                      {isOnline && !isRunning && (
                        <IconButton aria-label="시작" icon={<FiPlay />} size="xs" colorScheme="green" onClick={() => handleStart(w.id)} />
                      )}
                      {isOnline && isRunning && (
                        <IconButton aria-label="중지" icon={<FiSquare />} size="xs" colorScheme="orange" onClick={() => handleStop(w.id)} />
                      )}
                      <IconButton aria-label="수정" icon={<FiEdit2 />} size="xs" variant="ghost" onClick={() => openEdit(w)} />
                      <IconButton aria-label="삭제" icon={<FiTrash2 />} size="xs" variant="ghost" colorScheme="red" onClick={() => handleDelete(w.id)} />
                    </HStack>
                  </Td>
                </Tr>
              );
            })}
            {workers.length === 0 && (
              <Tr>
                <Td colSpan={13} textAlign="center" color="gray.500" py={6}>
                  등록된 워커가 없습니다. 워커를 추가해주세요.
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>

      {/* 워커 추가 모달 */}
      <Modal isOpen={isAddOpen} onClose={onAddClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>워커 PC 추가</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={4}>
              <FormControl isRequired>
                <FormLabel>워커 이름</FormLabel>
                <Input placeholder="예: 작업PC-1" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>로그인 ID</FormLabel>
                <Input placeholder="워커 로그인 ID" value={addForm.loginId} onChange={(e) => setAddForm({ ...addForm, loginId: e.target.value })} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>비밀번호</FormLabel>
                <Input type="password" placeholder="워커 비밀번호" value={addForm.loginPassword} onChange={(e) => setAddForm({ ...addForm, loginPassword: e.target.value })} />
              </FormControl>
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onAddClose}>취소</Button>
            <Button colorScheme="blue" onClick={handleAdd}>추가</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 워커 수정 모달 */}
      <Modal isOpen={isEditOpen} onClose={onEditClose} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>워커 수정: {editWorker?.name}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing={4}>
              <FormControl>
                <FormLabel>워커 이름</FormLabel>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </FormControl>
              <FormControl>
                <FormLabel>로그인 ID</FormLabel>
                <Input value={editForm.loginId} onChange={(e) => setEditForm({ ...editForm, loginId: e.target.value })} />
              </FormControl>
              <FormControl>
                <FormLabel>비밀번호</FormLabel>
                <Input type="password" value={editForm.loginPassword} onChange={(e) => setEditForm({ ...editForm, loginPassword: e.target.value })} />
              </FormControl>
              <FormControl>
                <FormLabel>배정 그룹 (비워두면 전체 그룹 작업)</FormLabel>
                <CheckboxGroup
                  value={editForm.assignedGroupNames}
                  onChange={(vals) => setEditForm({ ...editForm, assignedGroupNames: vals as string[] })}
                >
                  <Stack spacing={2}>
                    {groups.map((g) => {
                      const pCount = productCountForEditWorkerGroup.get(g.groupName) ?? 0;
                      return (
                        <Checkbox key={g.id} value={g.groupName}>
                          {g.groupName}
                          <Text as="span" fontSize="xs" color="gray.500" ml={2}>
                            ({pCount}개 상품)
                          </Text>
                        </Checkbox>
                      );
                    })}
                    {groups.length === 0 && (
                      <Text fontSize="sm" color="gray.400">등록된 그룹이 없습니다</Text>
                    )}
                  </Stack>
                </CheckboxGroup>
              </FormControl>
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onEditClose}>취소</Button>
            <Button colorScheme="blue" onClick={handleEdit}>저장</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Stack>
  );
}
