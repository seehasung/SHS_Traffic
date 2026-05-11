import { useEffect, useRef } from 'react';
import { Box, HStack, Tag, Text } from '@chakra-ui/react';
import type { LogEntry, LogLevel } from '@shared/types';

const tagColor: Record<LogLevel, string> = {
  info: 'gray',
  warn: 'yellow',
  error: 'red',
  success: 'green',
};

export default function LogStream({ logs }: { logs: LogEntry[] }) {
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [logs.length]);

  return (
    <Box
      ref={scroller}
      bg="gray.900"
      color="gray.100"
      fontFamily="mono"
      fontSize="sm"
      h="50vh"
      overflowY="auto"
      borderRadius="md"
      p={3}
    >
      {logs.length === 0 && (
        <Text color="gray.500">아직 로그가 없습니다. 시작 버튼을 누르면 여기에 표시됩니다.</Text>
      )}
      {logs.map((entry) => (
        <HStack key={entry.id} align="start" spacing={3} py={0.5}>
          <Text color="gray.500" minW="14ch">
            {new Date(entry.createdAt).toLocaleTimeString()}
          </Text>
          <Tag size="sm" colorScheme={tagColor[entry.level]} variant="subtle" minW="14">
            {entry.level}
          </Tag>
          <Text flex={1} whiteSpace="pre-wrap">
            {entry.message}
          </Text>
        </HStack>
      ))}
    </Box>
  );
}
