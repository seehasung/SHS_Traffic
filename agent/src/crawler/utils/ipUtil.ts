import https from 'https';

/**
 * 공인 IP(외부에서 보이는 IP)를 가져온다.
 * `public-ip` 패키지가 ESM-only 라 CommonJS 빌드에서 require() 에러가 나기 때문에,
 * Node 내장 https 모듈로 직접 ipify 등에 GET 요청해서 처리한다.
 *
 * - 여러 백업 서비스를 순서대로 시도 (한 곳이 막혀도 다른 곳으로 폴백)
 * - 각 요청에 timeout 적용
 */
const PUBLIC_IP_SERVICES = [
  'https://api.ipify.org',
  'https://ipv4.icanhazip.com',
  'https://ifconfig.me/ip',
];

const IPV4_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export async function getPublicIp(timeoutMs: number = 5000): Promise<string> {
  let lastErr: unknown = null;
  for (const url of PUBLIC_IP_SERVICES) {
    try {
      const body = await httpGetText(url, timeoutMs);
      const ip = body.trim();
      if (IPV4_REGEX.test(ip)) return ip;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    'PUBLIC_IP_FETCH_FAILED' + (lastErr ? `: ${(lastErr as Error).message ?? lastErr}` : ''),
  );
}

function httpGetText(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy(new Error('TIMEOUT'));
    });
    req.on('error', reject);
  });
}
