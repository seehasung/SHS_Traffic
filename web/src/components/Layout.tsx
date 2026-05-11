import { Box, Container, HStack, Heading, Spacer, Text, Button, Tag } from '@chakra-ui/react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { api } from '@/api';

interface Props extends PropsWithChildren {
  email?: string;
  connected: boolean;
  status: 'idle' | 'running' | 'stopping';
  isAdmin: boolean;
  onSignedOut: () => void;
}

export default function Layout({ children, email, connected, status, isAdmin, onSignedOut }: Props) {
  const location = useLocation();
  const tab = (path: string, label: string) => (
    <Button
      as={RouterLink}
      to={path}
      size="sm"
      variant={location.pathname === path ? 'solid' : 'ghost'}
    >
      {label}
    </Button>
  );

  const statusTag = (() => {
    if (!connected) return <Tag colorScheme="gray">연결 끊김</Tag>;
    if (status === 'running') return <Tag colorScheme="blue">실행 중</Tag>;
    if (status === 'stopping') return <Tag colorScheme="orange">정지 중</Tag>;
    return <Tag colorScheme="green">대기 중</Tag>;
  })();

  const onLogout = async () => {
    await api.logout();
    onSignedOut();
  };

  return (
    <Box>
      <Box borderBottomWidth="1px" bg="white" position="sticky" top={0} zIndex={10}>
        <Container maxW="7xl">
          <HStack py={3}>
            <Heading size="sm">지식쇼핑 상위노출 콘솔</Heading>
            <Box mx={4}>
              <HStack spacing={1}>
                {tab('/', isAdmin ? '워커 관리' : '대시보드')}
                {tab('/knowledges', '키워드/상품')}
                {tab('/naver-accounts', '네이버 계정')}
                {tab('/settings', '작업 설정')}
              </HStack>
            </Box>
            <Spacer />
            {statusTag}
            <Tag colorScheme={isAdmin ? 'purple' : 'teal'} size="sm">
              {isAdmin ? '관리자' : '워커'}
            </Tag>
            <Text fontSize="sm" color="gray.500">
              {email}
            </Text>
            <Button size="sm" variant="ghost" onClick={onLogout}>
              로그아웃
            </Button>
          </HStack>
        </Container>
      </Box>
      <Container maxW="7xl" py={6}>
        {children}
      </Container>
    </Box>
  );
}
