import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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
import { FiTrash2, FiUpload, FiDownload } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import type { CafeEntry } from '@shared/types';
import { api } from '@/api';

export default function CafeManagePage() {
  const [entries, setEntries] = useState<CafeEntry[]>([]);
  const [newCafe, setNewCafe] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [uploading, setUploading] = useState(false);
  const [filterCafe, setFilterCafe] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const items = await api.cafeEntries.list();
    setEntries(items);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const cafeNames = useMemo(() => [...new Set(entries.map((e) => e.cafeName))].sort(), [entries]);
  const keywords = useMemo(() => [...new Set(entries.map((e) => e.targetKeyword))].sort(), [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (filterCafe) list = list.filter((e) => e.cafeName === filterCafe);
    if (filterKeyword) list = list.filter((e) => e.targetKeyword === filterKeyword);
    return list;
  }, [entries, filterCafe, filterKeyword]);

  const addEntry = async () => {
    const cafe = newCafe.trim();
    const title = newTitle.trim();
    const kw = newKeyword.trim();
    if (!cafe || !title || !kw) {
      toast({ title: '카페명, 제목, 타겟 키워드를 모두 입력해주세요', status: 'warning', position: 'top' });
      return;
    }
    try {
      await api.cafeEntries.create({ cafeName: cafe, postTitle: title, targetKeyword: kw });
      setNewCafe(''); setNewTitle(''); setNewKeyword('');
      refresh();
      toast({ title: '카페가 추가되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? '추가 실패', status: 'error', position: 'top' });
    }
  };

  const removeEntry = async (id: string) => {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    try {
      await api.cafeEntries.remove(id);
      refresh();
      toast({ title: '삭제되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? '삭제 실패', status: 'error', position: 'top' });
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      const items: { cafeName: string; postTitle: string; targetKeyword: string }[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        const cafeName = String(row[0]).trim();
        const postTitle = String(row[1] ?? '').trim();
        const targetKeyword = String(row[2] ?? '').trim();
        if (cafeName && postTitle && targetKeyword) {
          items.push({ cafeName, postTitle, targetKeyword });
        }
      }

      if (items.length === 0) {
        toast({ title: '유효한 데이터가 없습니다. A열: 카페명, B열: 제목, C열: 타겟 키워드 (1행은 머릿말)', status: 'warning', position: 'top' });
        return;
      }

      const result = await api.cafeEntries.bulk(items);
      refresh();
      toast({ title: `${result.created}개 항목이 등록되었습니다`, status: 'success', position: 'top' });
    } catch (err: any) {
      toast({ title: err?.message ?? '업로드 실패', status: 'error', position: 'top' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['카페명', '제목', '타겟 키워드'],
      ['예시카페', '예시 게시글 제목', '타겟키워드'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '카페');
    XLSX.writeFile(wb, '카페_업로드_템플릿.xlsx');
  };

  return (
    <Stack spacing={5}>
      <HStack justify="space-between">
        <HStack>
          <Heading size="md">카페 관리</Heading>
          <Badge colorScheme="purple" fontSize="sm">{entries.length}개</Badge>
        </HStack>
        <HStack>
          <Button size="sm" leftIcon={<FiDownload />} variant="outline" onClick={downloadTemplate}>
            템플릿 다운로드
          </Button>
          <Button size="sm" leftIcon={<FiUpload />} colorScheme="green" isLoading={uploading} onClick={() => fileInputRef.current?.click()}>
            엑셀 일괄 업로드
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleExcelUpload} />
        </HStack>
      </HStack>

      <HStack>
        <Select placeholder="카페명 필터" value={filterCafe} onChange={(e) => setFilterCafe(e.target.value)} maxW="250px" size="sm">
          {cafeNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <Select placeholder="타겟 키워드 필터" value={filterKeyword} onChange={(e) => setFilterKeyword(e.target.value)} maxW="250px" size="sm">
          {keywords.map((k) => <option key={k} value={k}>{k}</option>)}
        </Select>
        {(filterCafe || filterKeyword) && (
          <Button size="sm" variant="ghost" onClick={() => { setFilterCafe(''); setFilterKeyword(''); }}>필터 초기화</Button>
        )}
      </HStack>

      <Box borderWidth="1px" borderRadius="lg" p={4}>
        <HStack mb={4}>
          <Input placeholder="카페명" value={newCafe} onChange={(e) => setNewCafe(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntry()} />
          <Input placeholder="제목" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntry()} />
          <Input placeholder="타겟 키워드" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntry()} />
          <Button colorScheme="blue" onClick={addEntry} flexShrink={0}>추가</Button>
        </HStack>
        <Table size="sm">
          <Thead bg="gray.50">
            <Tr>
              <Th>카페명</Th>
              <Th>제목</Th>
              <Th>타겟 키워드</Th>
              <Th w="80px"></Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.map((e) => (
              <Tr key={e.id}>
                <Td>{e.cafeName}</Td>
                <Td>{e.postTitle}</Td>
                <Td>{e.targetKeyword}</Td>
                <Td>
                  <IconButton aria-label="삭제" icon={<FiTrash2 />} size="sm" variant="ghost" colorScheme="red" onClick={() => removeEntry(e.id)} />
                </Td>
              </Tr>
            ))}
            {filtered.length === 0 && (
              <Tr>
                <Td colSpan={4} textAlign="center" color="gray.500" py={6}>
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
