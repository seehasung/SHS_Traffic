import { Box, Container, HStack, Heading, Spacer, Text, Button, Tag, Menu, MenuButton, MenuList, MenuItem } from '@chakra-ui/react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { FiChevronDown } from 'react-icons/fi';
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
  const navigate = useNavigate();

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

  const dropdownMenu = (label: string, items: { path: string; label: string }[]) => {
    const isActive = items.some((item) => location.pathname === item.path);
    return (
      <Menu>
        <MenuButton
          as={Button}
          size="sm"
          variant={isActive ? 'solid' : 'ghost'}
          rightIcon={<FiChevronDown />}
        >
          {label}
        </MenuButton>
        <MenuList minW="140px" zIndex={20}>
          {items.map((item) => (
            <MenuItem
              key={item.path}
              onClick={() => navigate(item.path)}
              fontWeight={location.pathname === item.path ? 'bold' : 'normal'}
              bg={location.pathname === item.path ? 'blue.50' : undefined}
            >
              {item.label}
            </MenuItem>
          ))}
        </MenuList>
      </Menu>
    );
  };

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
            <Heading size="sm">SHS_Traffic</Heading>
            <Box mx={4}>
              <HStack spacing={1}>
                {tab('/', isAdmin ? '워커 관리' : '대시보드')}
                {dropdownMenu('C랭크', [
                  { path: '/crank', label: 'C랭크' },
                  { path: '/cafe-manage', label: '카페 관리' },
                ])}
                {dropdownMenu('상품', [
                  { path: '/knowledges', label: '키워드/상품' },
                  { path: '/products', label: '상품 관리' },
                ])}
                {tab('/naver-accounts', '네이버 계정')}
                {tab('/settings', '작업 설정')}
                {isAdmin && dropdownMenu('순위추적', [
                  { path: '/rank-check', label: '상품 순위' },
                  { path: '/crank-check', label: 'C랭크 순위' },
                ])}
                {isAdmin && tab('/worker-logs', '로그')}
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
