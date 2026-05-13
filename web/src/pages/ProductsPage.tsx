import { useEffect, useState, useCallback } from 'react';
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
} from '@chakra-ui/react';
import { FiTrash2 } from 'react-icons/fi';
import type { Product } from '@shared/types';
import { api } from '@/api';

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
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

  return (
    <Stack spacing={5}>
      <Heading size="md">상품 관리</Heading>
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
