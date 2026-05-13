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
    const waitSeconds = 3;

    for (let i = 0; i < repeat; i++) {
      const prevIp = await this.getIp();

      if (!prevIp) {
        crawlerUtil.log('모바일 데이터가 꺼져있습니다.');
        continue;
      }

      await this.toggleMobileNetwork({ deviceId, waitSeconds });
      await crawlerUtil.delay(waitSeconds * 1000);

      const nextIp = await this.getIp();

      if (prevIp === nextIp) {
        crawlerUtil.log(
          `IP변경 재시도 횟수 : ${i + 1} (계속 실패 하면 테더링이 켜져있나 확인해주세요.)\n`,
        );
        crawlerUtil.log(`${waitSeconds}초 뒤 IP 변경을 재시도하겠습니다.`);
        await crawlerUtil.delay(waitSeconds * 1000);
      } else {
        crawlerUtil.log(
          `IP주소가 "${prevIp || '비행기모드'}" -> "${nextIp}"로 변경되었습니다.`,
        );
        await crawlerUtil.delay(waitSeconds * 1000);
        return nextIp;
      }
    }

    return undefined;
  }

  async toggleMobileNetwork({ deviceId, waitSeconds }: ToggleMobileNetworkParams): Promise<void> {
    const sleep = Math.round(waitSeconds);
    const command = `svc data disable; sleep ${sleep}; svc data enable`;

    await this.execCommand(deviceId, command);
    crawlerUtil.log(`아이피를 변경중입니다. ${waitSeconds}초 기다리겠습니다.`);
    await crawlerUtil.delay(waitSeconds * 1000);
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
