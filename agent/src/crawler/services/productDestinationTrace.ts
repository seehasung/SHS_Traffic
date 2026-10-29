import crypto from 'crypto';
import type { Page } from 'puppeteer-core';

/** 상품 목적지 검증 과정을 탭 단위로 추적하기 위한 진단 로그. */

export const getProductDestinationTargetToken = (page?: Page): string => {
  try {
    const target = page?.target() as any;
    const rawTargetId = target?._targetId || target?._targetInfo?.targetId;
    if (!rawTargetId) return 'unavailable';
    return crypto.createHash('sha256').update(String(rawTargetId)).digest('hex').slice(0, 12);
  } catch {
    return 'unavailable';
  }
};

export const getSafeProductDestinationOutcome = (error: unknown): string => {
  try {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NAVER_PRODUCT_LOGIN_REDIRECT' || message === 'PRODUCT_DESTINATION_UNSETTLED') return message;
    return 'OTHER';
  } catch {
    return 'OTHER';
  }
};

const writeDiagnostic = (writer: (message: string) => void | Promise<void>, message: string) => {
  try {
    void Promise.resolve(writer(message)).catch(() => undefined);
  } catch {
    // 진단 로그가 크롤러 결과를 바꾸면 안 된다
  }
};

export const runWithProductDestinationTrace = async <T>(
  targetToken: string,
  writer: (message: string) => void | Promise<void>,
  operation: () => Promise<T>,
): Promise<T> => {
  writeDiagnostic(writer, `[상품 목적지 검증 시작] target=${targetToken}`);
  try {
    const result = await operation();
    writeDiagnostic(writer, `[상품 목적지 검증 완료] target=${targetToken}`);
    return result;
  } catch (error) {
    writeDiagnostic(writer, `[상품 목적지 검증 실패] target=${targetToken} outcome=${getSafeProductDestinationOutcome(error)}`);
    throw error;
  }
};
