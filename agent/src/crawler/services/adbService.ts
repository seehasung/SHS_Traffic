import Adb from '@devicefarmer/adbkit';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';
import { crawlerUtil } from '../utils/crawlerUtil';

function getPublicIp(): Promise<string> {
  return new Promise((resolve, reject) => {
    const get = https.get;
    get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => resolve(data.trim()));
      res.on('error', reject);
    }).on('error', () => {
      http.get('http://api.ipify.org', (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => resolve(data.trim()));
        res.on('error', reject);
      }).on('error', reject);
    });
  });
}

function copyAdb(): string {
  const isPackaged = !!(process as any).resourcesPath && process.env.AGENT_DEV !== '1';
  const src = isPackaged
    ? path.join((process as any).resourcesPath, 'platform-tools')
    : path.resolve(__dirname, '..', '..', '..', '..', '..', 'platform-tools');

  const dist = path.join('C:', 'platform-tools');

  if (fs.existsSync(path.join(dist, 'adb.exe'))) {
    return dist;
  }

  if (!fs.existsSync(src)) {
    crawlerUtil.log(`[ADB] platform-tools 소스 경로를 찾을 수 없습니다: ${src}`);
    return dist;
  }

  fs.mkdirSync(dist, { recursive: true });
  fs.cpSync(src, dist, { recursive: true });
  return dist;
}

interface ToggleMobileNetworkParams {
  deviceId: string;
  waitSeconds: number;
}

interface ChangeIpAddressParams {
  deviceId: string;
  repeat: number;
}

class AdbService {
  private client: ReturnType<typeof Adb.createClient> | null = null;

  async init(): Promise<void> {
    try {
      const dist = copyAdb();
      const adbPath = path.join(dist, 'adb.exe');

      this.client = Adb.createClient({ bin: adbPath });
      execSync(`"${adbPath}" start-server`);

      if (await this.isConnected()) {
        crawlerUtil.log('adb devices 연결됨');
        crawlerUtil.log('adb 초기화 성공 경로: ' + adbPath);
      }
    } catch (e: any) {
      crawlerUtil.log('adb 초기화 실패: ' + e.message);
    }
  }

  async isConnected(): Promise<boolean> {
    const devices = await this.client?.listDevices();
    return !!devices && devices.length > 0;
  }

  private async getDeviceId(): Promise<string> {
    const devices = await this.client?.listDevices();
    if (!devices || devices.length === 0) {
      throw new Error('연결된 ADB 디바이스가 없습니다.');
    }
    return devices[0].id;
  }

  async getChangedIp(): Promise<string | undefined> {
    const devices = await this.client?.listDevices();
    if (!devices || devices.length === 0) {
      crawlerUtil.log('연결된 ADB 디바이스가 없습니다.');
      return undefined;
    }
    const deviceInfo = devices[0];
    console.log(deviceInfo);
    return await this.changeIpAddress({ deviceId: deviceInfo.id, repeat: 500 });
  }

  async changeIpAddress({ deviceId, repeat }: ChangeIpAddressParams): Promise<string | undefined> {
    const disableSeconds = 5;
    const waitAfterEnable = 5;

    for (let i = 0; i < repeat; i++) {
      let prevIp = '';
      try {
        prevIp = await this.getIp();
      } catch {
        crawlerUtil.log('IP 조회 실패 (인터넷 연결 없음). 데이터 재활성화 후 재시도합니다.');
        await this.execCommand(deviceId, 'svc data enable').catch(() => {});
        await crawlerUtil.delay(5000);
        continue;
      }

      if (!prevIp) {
        crawlerUtil.log('모바일 데이터가 꺼져있습니다.');
        continue;
      }

      crawlerUtil.log(`[디버그] 변경 전 IP: ${prevIp}`);
      await this.toggleMobileNetwork({ deviceId, disableSeconds });
      await crawlerUtil.delay(waitAfterEnable * 1000);

      let nextIp = '';
      try {
        nextIp = await this.getIp();
      } catch {
        crawlerUtil.log('IP 조회 실패. 테더링 연결이 끊어졌을 수 있습니다. 재시도합니다.');
        await crawlerUtil.delay(3000);
        continue;
      }

      crawlerUtil.log(`[디버그] 변경 후 IP: ${nextIp}`);

      if (prevIp === nextIp) {
        crawlerUtil.log(
          `IP변경 재시도 횟수 : ${i + 1} (계속 실패 하면 PC의 WiFi/이더넷을 끄고 USB테더링만 사용해주세요.)\n`,
        );
        crawlerUtil.log(`${disableSeconds}초 뒤 IP 변경을 재시도하겠습니다.`);
        await crawlerUtil.delay(disableSeconds * 1000);
      } else {
        crawlerUtil.log(
          `IP주소가 "${prevIp || '비행기모드'}" -> "${nextIp}"로 변경되었습니다.`,
        );
        await crawlerUtil.delay(3000);
        return nextIp;
      }
    }

    return undefined;
  }

  async toggleMobileNetwork({ deviceId, disableSeconds }: { deviceId: string; disableSeconds: number }): Promise<void> {
    const sleep = Math.round(disableSeconds);
    const command = `svc data disable; sleep ${sleep}; svc data enable`;

    await this.execCommand(deviceId, command);
    crawlerUtil.log(`아이피를 변경중입니다. 데이터 OFF ${disableSeconds}초 후 ON`);
    await crawlerUtil.delay(disableSeconds * 1000);
  }

  async getIp(): Promise<string> {
    return getPublicIp();
  }

  async execCommand(deviceId: string, command: string): Promise<string> {
    const device = this.client?.getDevice(deviceId);
    const stream = await device?.shell(command);
    const output = await Adb.util.readAll(stream);
    return output.toString().trim();
  }

  async close(): Promise<void> {
    // cleanup if needed
  }
}

export const adbService = new AdbService();
