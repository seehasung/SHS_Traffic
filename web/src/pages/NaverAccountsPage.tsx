import { useEffect, useState } from 'react';
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
} from '@chakra-ui/react';
import { FiTrash2 } from 'react-icons/fi';
import type { NaverAccount } from '@shared/types';
import { api } from '@/api';

export default function NaverAccountsPage() {
  const [items, setItems] = useState<NaverAccount[]>([]);
  const [draft, setDraft] = useState({ naverId: '', naverPassword: '', userAgent: '' });
  const toast = useToast();

  const refresh = () => api.naverAccounts.list().then(setItems);
  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    if (!draft.naverId || !draft.naverPassword) {
      toast({ title: '아이디와 비밀번호는 필수입니다', status: 'warning', position: 'top' });
      return;
    }
    await api.naverAccounts.upsert({
      naverId: draft.naverId.trim(),
      naverPassword: draft.naverPassword,
      userAgent: draft.userAgent.trim() || undefined,
    });
    setDraft({ naverId: '', naverPassword: '', userAgent: '' });
    refresh();
  };

  return (
    <Stack spacing={5}>
      <Heading size="md">네이버 계정</Heading>

      <Box borderWidth="1px" borderRadius="lg" p={4}>
        <HStack>
          <Input
            placeholder="네이버 아이디"
            value={draft.naverId}
            onChange={(e) => setDraft({ ...draft, naverId: e.target.value })}
          />
          <Input
            placeholder="비밀번호"
            type="password"
            value={draft.naverPassword}
            onChange={(e) => setDraft({ ...draft, naverPassword: e.target.value })}
          />
          <Input
            placeholder="User-Agent (선택)"
            value={draft.userAgent}
            onChange={(e) => setDraft({ ...draft, userAgent: e.target.value })}
          />
          <Button onClick={add} colorScheme="blue" px={6}>
            추가
          </Button>
        </HStack>
      </Box>

      <Box borderWidth="1px" borderRadius="lg" overflow="hidden">
        <Table size="sm">
          <Thead bg="gray.50">
            <Tr>
              <Th>아이디</Th>
              <Th>User-Agent</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {items.map((a) => (
              <Tr key={a.id}>
                <Td>{a.naverId}</Td>
                <Td fontSize="xs" color="gray.500" maxW="500px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {a.userAgent ?? '(기본값)'}
                </Td>
                <Td isNumeric>
                  <IconButton
                    aria-label="삭제"
                    size="sm"
                    variant="ghost"
                    icon={<FiTrash2 />}
                    onClick={async () => {
                      await api.naverAccounts.remove(a.id);
                      refresh();
                    }}
                  />
                </Td>
              </Tr>
            ))}
            {items.length === 0 && (
              <Tr>
                <Td colSpan={3} textAlign="center" color="gray.500" py={6}>
                  아직 등록된 계정이 없습니다.
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>
    </Stack>
  );
}
