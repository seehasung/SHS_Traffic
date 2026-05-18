import https from 'https';

/**
 * 공인 IPv4 주소(외부에서 보이는 IP)를 가져온다.
 *
 * 중요: 반드시 IPv4 로 강제한다.
 *  - 대부분의 VPN 은 IPv4 트래픽만 우회한다. IPv6 는 그대로 빠져나가므로,
 *    IPv6 주소를 가져오면 VPN 을 켜도 IP 가 안 바뀐 것처럼 보여서
 *    무한 재시도 루프에 빠진다.
 *  - `api.ipify.org` 같은 dual-stack endpoint 는 OS 의 IPv6 우선 정책에 따라
 *    IPv6 응답을 줄 수 있으므로, IPv4 전용 endpoint + family:4 옵션을 함께 사용.
 *
 * `public-ip` 패키지가 ESM-only 라 CommonJS 빌드에서 require() 에러가 나기 때문에
 * Node 내장 https 모듈로 직접 ipify 등에 GET 요청해서 처리한다.
 */
// 모두 IPv4 전용 hostname 우선 (절대 IPv6 가 오지 않도록)
const PUBLIC_IP_SERVICES = [
  'https://api4.ipify.org',      // ipify - IPv4 전용 hostname (확정)
  'https://ipv4.icanhazip.com',  // icanhazip - IPv4 전용 hostname (확정)
  'https://api.ipify.org',       // dual-stack 백업 (family:4 강제 적용)
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
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        family: 4, // IPv4 강제 - DNS 조회/연결을 IPv4 로만 (VPN 우회 보장)
        // 캐시/keep-alive 영향 최소화
        headers: {
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          accept: 'text/plain',
          'user-agent': 'shs-traffic-worker',
        },
      },
      (res) => {
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
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('TIMEOUT'));
    });
    req.on('error', reject);
  });
}
