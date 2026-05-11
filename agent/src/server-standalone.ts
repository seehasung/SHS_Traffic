import { startServer } from './server';
import { DEFAULT_AGENT_PORT } from '@shared/api';

(async () => {
  const port = Number(process.env.PORT) || DEFAULT_AGENT_PORT;
  const host = process.env.HOST || '0.0.0.0';
  const srv = await startServer({ port, host });
  console.log(`[Agent] 서버 시작됨: http://${host}:${srv.port}`);

  const shutdown = async () => {
    console.log('[Agent] 서버 종료 중...');
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
