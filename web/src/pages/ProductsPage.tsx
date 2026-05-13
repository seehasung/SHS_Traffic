import { useEffect, useState, useCallback, useRef } from 'react';
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
  Editable,
  EditableInput,
  EditablePreview,
  Text,
  Badge,
} from '@chakra-ui/react';
import { FiTrash2, FiUpload, FiDownload } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import type { Product } from '@shared/types';
import { api } from '@/api';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const items = await api.products.list();
    setProducts(items);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addProduct = async () => {
    const name = newName.trim();
    const number = newNumber.trim();
    if (!name || !number) {
      toast({ title: '상품명과 상품번호를 모두 입력해주세요', status: 'warning', position: 'top' });
      return;
    }
    try {
      await api.products.create(name, number);
      setNewName('');
      setNewNumber('');
      refresh();
      toast({ title: '상품이 추가되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? '추가 실패', status: 'error', position: 'top' });
    }
  };

  const updateProductName = async (id: string, productName: string) => {
    const val = productName.trim();
    if (!val) return;
    const p = products.find((x) => x.id === id);
    if (!p || p.productName === val) return;
    try {
      await api.products.update(id, { productName: val });
      refresh();
    } catch (e: any) {
      toast({ title: e?.message ?? '수정 실패', status: 'error', position: 'top' });
    }
  };

  const updateProductNumber = async (id: string, productNumber: string) => {
    const val = productNumber.trim();
    if (!val) return;
    const p = products.find((x) => x.id === id);
    if (!p || p.productNumber === val) return;
    try {
      await api.products.update(id, { productNumber: val });
      refresh();
    } catch (e: any) {
      toast({ title: e?.message ?? '수정 실패', status: 'error', position: 'top' });
    }
  };

  const removeProduct = async (id: string) => {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return;
    try {
      await api.products.remove(id);
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
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown as unknown[][];

      const items: { productName: string; productNumber: string }[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        const productName = String(row[0]).trim();
        const productNumber = String(row[1] ?? '').trim();
        if (productName && productNumber) {
          items.push({ productName, productNumber });
        }
      }

      if (items.length === 0) {
        toast({ title: '유효한 데이터가 없습니다. A열: 상품명, B열: 상품번호 (1행은 머릿말)', status: 'warning', position: 'top' });
        return;
      }

      const result = await api.products.bulk(items);
      refresh();
      toast({ title: `${result.created}개 상품이 등록되었습니다`, status: 'success', position: 'top' });
    } catch (err: any) {
      toast({ title: err?.message ?? '업로드 실패', status: 'error', position: 'top' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['상품명', '상품번호'],
      ['예시 상품', '12345678'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '상품');
    XLSX.writeFile(wb, '상품_업로드_템플릿.xlsx');
  };

  return (
    <Stack spacing={5}>
      <HStack justify="space-between">
        <HStack>
          <Heading size="md">상품 관리</Heading>
          <Badge colorScheme="blue" fontSize="sm">{products.length}개</Badge>
        </HStack>
        <HStack>
          <Button size="sm" leftIcon={<FiDownload />} variant="outline" onClick={downloadTemplate}>
            템플릿 다운로드
          </Button>
          <Button
            size="sm"
            leftIcon={<FiUpload />}
            colorScheme="green"
            isLoading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            엑셀 일괄 업로드
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleExcelUpload}
          />
        </HStack>
      </HStack>
      <Box borderWidth="1px" borderRadius="lg" p={4}>
        <HStack mb={4}>
          <Input
            placeholder="상품명"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProduct()}
          />
          <Input
            placeholder="상품번호"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProduct()}
          />
          <Button colorScheme="blue" onClick={addProduct} flexShrink={0}>추가</Button>
        </HStack>
        <Table size="sm">
          <Thead bg="gray.50">
            <Tr>
              <Th>상품명</Th>
              <Th>상품번호</Th>
              <Th w="100px"></Th>
            </Tr>
          </Thead>
          <Tbody>
            {products.map((p) => (
              <Tr key={p.id}>
                <Td>
                  <Editable defaultValue={p.productName} onSubmit={(val) => updateProductName(p.id, val)}>
                    <EditablePreview />
                    <EditableInput />
                  </Editable>
                </Td>
                <Td>
                  <Editable defaultValue={p.productNumber} onSubmit={(val) => updateProductNumber(p.id, val)}>
                    <EditablePreview />
                    <EditableInput />
                  </Editable>
                </Td>
                <Td>
                  <IconButton
                    aria-label="삭제"
                    icon={<FiTrash2 />}
                    size="sm"
                    variant="ghost"
                    colorScheme="red"
                    onClick={() => removeProduct(p.id)}
                  />
                </Td>
              </Tr>
            ))}
            {products.length === 0 && (
              <Tr>
                <Td colSpan={3} textAlign="center" color="gray.500" py={6}>
                  <Text>등록된 상품이 없습니다. 상품을 추가해주세요.</Text>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>
    </Stack>
  );
}
