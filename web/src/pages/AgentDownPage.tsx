import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Container, Stack, Text } from '@chakra-ui/react';

export default function AgentDownPage({ onRetry }: { onRetry: () => void }) {
  return (
    <Container maxW="md" py={20}>
      <Alert status="error" variant="left-accent" borderRadius="md">
        <AlertIcon />
        <Box flex={1}>
          <AlertTitle>에이전트와 연결할 수 없습니다</AlertTitle>
          <AlertDescription>
            <Stack spacing={2} mt={2} fontSize="sm">
              <Text>이 콘솔은 같은 PC에서 동작하는 에이전트와 통신해야 합니다.</Text>
              <Text>
                ① 트레이에서 <b>지식쇼핑 에이전트</b> 가 실행 중인지 확인 →<br />② 실행되어 있다면 잠시 후
                재시도해 보세요.
              </Text>
            </Stack>
            <Button mt={4} size="sm" colorScheme="red" variant="outline" onClick={onRetry}>
              다시 시도
            </Button>
          </AlertDescription>
        </Box>
      </Alert>
    </Container>
  );
}
