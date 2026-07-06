import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  Heading,
  HStack,
  IconButton,
  Input,
  Stack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useToast,
  Text,
  Badge,
  Select,
} from '@chakra-ui/react';
import { FiTrash2 } from 'react-icons/fi';
import type { CafeEntry } from '@shared/types';
import { api } from '@/api';

export default function CafeManagePage() {
  const [entries, setEntries] = useState<CafeEntry[]>([]);
  const [newCafe, setNewCafe] = useState('');
  const [filterCafe, setFilterCafe] = useState('');
  const toast = useToast();

  const refresh = useCallback(async () => {
    const items = await api.cafeEntries.list();
    setEntries(items);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const cafeNames = useMemo(() => [...new Set(entries.map((e) => e.cafeName))].sort(), [entries]);

  const filtered = useMemo(() => {
    if (!filterCafe) return entries;
    return entries.filter((e) => e.cafeName === filterCafe);
  }, [entries, filterCafe]);

  const addEntry = async () => {
    const cafe = newCafe.trim();
    if (!cafe) {
      toast({ title: '카페명을 입력해주세요', status: 'warning', position: 'top' });
      return;
    }
    if (entries.some((e) => e.cafeName === cafe)) {
      toast({ title: '이미 등록된 카페입니다', status: 'warning', position: 'top' });
      return;
    }
    try {
      await api.cafeEntries.create({ cafeName: cafe });
      setNewCafe('');
      refresh();
      toast({ title: '카페가 추가되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? '추가 실패', status: 'error', position: 'top' });
    }
  };

  const removeEntry = async (id: string) => {
    if (!confirm('이 카페를 삭제하시겠습니까?')) return;
    try {
      await api.cafeEntries.remove(id);
      refresh();
      toast({ title: '삭제되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? '삭제 실패', status: 'error', position: 'top' });
    }
  };

  return (
    <Stack spacing={5}>
      <HStack justify="space-between">
        <HStack>
          <Heading size="md">카페 관리</Heading>
          <Badge colorScheme="purple" fontSize="sm">{entries.length}개</Badge>
        </HStack>
      </HStack>

      <HStack>
        <Select placeholder="카페명 필터" value={filterCafe} onChange={(e) => setFilterCafe(e.target.value)} maxW="250px" size="sm">
          {cafeNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        {filterCafe && (
          <Button size="sm" variant="ghost" onClick={() => setFilterCafe('')}>필터 초기화</Button>
        )}
      </HStack>

      <Box borderWidth="1px" borderRadius="lg" p={4}>
        <HStack mb={4}>
          <Input placeholder="카페명" value={newCafe} onChange={(e) => setNewCafe(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntry()} />
          <Button colorScheme="blue" onClick={addEntry} flexShrink={0}>추가</Button>
        </HStack>
        <Table size="sm">
          <Thead bg="gray.50">
            <Tr>
              <Th>카페명</Th>
              <Th>등록일</Th>
              <Th w="80px"></Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((e) => (
              <Tr key={e.id}>
                <Td>{e.cafeName}</Td>
                <Td>{new Date(e.createdAt).toLocaleDateString()}</Td>
                <Td>
                  <IconButton aria-label="삭제" icon={<FiTrash2 />} size="sm" variant="ghost" colorScheme="red" onClick={() => removeEntry(e.id)} />
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && (
              <Tr>
                <Td colSpan={3} textAlign="center" color="gray.500" py={6}>
                  <Text>등록된 카페가 없습니다.</Text>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>
    </Stack>
  );
}
