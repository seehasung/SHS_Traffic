import { useState } from 'react';
import {
  Box,
  Button,
  Container,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Stack,
  Text,
  useToast,
} from '@chakra-ui/react';
import { api } from '@/api';

interface Props {
  mode: 'first-run' | 'guest';
  onAuthed: () => void;
}

export default function LoginPage({ mode, onAuthed }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    if (!email || password.length < 4) {
      toast({ title: '이메일과 4자 이상의 비밀번호를 입력하세요', status: 'warning', position: 'top' });
      return;
    }
    setBusy(true);
    try {
      if (mode === 'first-run') await api.setup(email, password);
      else await api.login(email, password);
      onAuthed();
    } catch (e: any) {
      toast({ title: e?.message ?? String(e), status: 'error', position: 'top' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxW="sm" py={20}>
      <Stack spacing={6}>
        <Heading size="lg" textAlign="center">
          지식쇼핑 상위노출 콘솔
        </Heading>
        <Text fontSize="sm" color="gray.500" textAlign="center">
          {mode === 'first-run' ? '최초 관리자 계정을 만들어 주세요' : '계정으로 로그인하세요'}
        </Text>
        <Box borderWidth="1px" borderRadius="lg" p={6}>
          <Stack spacing={4}>
            <FormControl>
              <FormLabel>이메일 (또는 아이디)</FormLabel>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" />
            </FormControl>
            <FormControl>
              <FormLabel>비밀번호</FormLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'first-run' ? 'new-password' : 'current-password'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
              />
            </FormControl>
            <Button colorScheme="blue" onClick={submit} isLoading={busy}>
              {mode === 'first-run' ? '계정 만들기' : '로그인'}
            </Button>
          </Stack>
        </Box>
        <Text fontSize="xs" color="gray.500" textAlign="center">
          데이터는 사용자 PC의 에이전트 안에만 저장됩니다. 외부 서버로 전송되지 않습니다.
        </Text>
      </Stack>
    </Container>
  );
}
