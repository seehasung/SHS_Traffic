import type { Page } from 'puppeteer-core';
import { crawlerUtil } from '../utils/crawlerUtil';

/**
 * 상품 상세페이지에서 옵션을 사람처럼 하나씩 골라본다.
 *
 * 네이버 스마트스토어는 옵션 UI의 class 이름이 해시라 고정 셀렉터를 쓸 수 없다.
 * 그래서 네이티브 select -> ARIA 드롭다운 -> 네이버 class 패턴 순서로 훑고,
 * 못 찾으면 조용히 넘어간다. 옵션 선택은 가격 표시만 바꿀 뿐 구매로 이어지지 않지만
 * 구매·장바구니 같은 버튼은 어떤 경우에도 누르지 않도록 따로 걸러낸다.
 */

const MARKER = 'data-shs-opt-id';

/** 눌리면 안 되는 컨트롤. 옵션처럼 보여도 제외한다. */
const FORBIDDEN_TEXT = /구매하기|장바구니|바로구매|선물하기|정기구독|톡톡|문의|신고|찜|쿠폰|결제|주문/;
/** 고를 수 없는 옵션. */
const SOLD_OUT_TEXT = /품절|재고\s*없|일시\s*품절|sold\s*out|구매\s*불가/i;
/** "옵션을 선택해 주세요" 같은 안내 항목. */
const PLACEHOLDER_TEXT = /선택해|선택하세요|선택 하세요|^[-\s]*\[?필수\]?|^옵션\s*선택|choose|please select/i;

interface OptionCandidate {
  id: string;
  kind: 'select' | 'dropdown';
  label: string;
}

/** 옵션 후보 컨트롤에 표식을 달고 목록을 돌려준다. */
async function markOptionCandidates(page: Page, handledIds: string[]): Promise<OptionCandidate[]> {
  return page.evaluate(
    (marker: string, forbiddenSource: string, handled: string[]) => {
      const forbidden = new RegExp(forbiddenSource);
      const results: { id: string; kind: 'select' | 'dropdown'; label: string }[] = [];
      let counter = 0;

      // 구매 옵션은 페이지 윗부분에 있다. 아래쪽 리뷰 옵션 필터를 잘못 누르지 않도록 범위를 자른다
      const optionAreaBottom = document.body.scrollHeight * 0.4;

      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 10) return false;
        if (rect.top + window.scrollY > optionAreaBottom) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      };

      const textOf = (el: Element) => String((el as HTMLElement).innerText || el.textContent || '').trim();

      const register = (el: Element, kind: 'select' | 'dropdown') => {
        const existing = el.getAttribute(marker);
        const id = existing ?? `o${counter++}_${Date.now().toString(36)}`;
        if (!existing) el.setAttribute(marker, id);
        if (handled.includes(id)) return;
        results.push({ id, kind, label: textOf(el).slice(0, 40) });
      };

      // 1) 네이티브 select
      for (const el of Array.from(document.querySelectorAll('select'))) {
        if ((el as HTMLSelectElement).disabled || !isVisible(el)) continue;
        // 수량 선택처럼 숫자만 있는 건 옵션이 아니다
        const texts = Array.from(el.options).map((o) => o.text.trim());
        if (texts.length < 2) continue;
        if (texts.every((t) => /^\d+$/.test(t))) continue;
        register(el, 'select');
      }

      // 2) ARIA 드롭다운 + 네이버 class 패턴
      const dropdownSelectors = [
        '[role="combobox"]',
        '[aria-haspopup="listbox"]',
        '[class*="optionSelect"]',
        '[class*="option_select"]',
        '[class*="_option"] [role="button"]',
      ];
      for (const selector of dropdownSelectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          if (!isVisible(el)) continue;
          const text = textOf(el);
          if (forbidden.test(text)) continue;
          if (el.getAttribute('aria-disabled') === 'true') continue;
          register(el, 'dropdown');
        }
      }

      return results;
    },
    MARKER,
    FORBIDDEN_TEXT.source,
    handledIds,
  );
}

/** 네이티브 select 에서 고를 수 있는 값 하나를 무작위로 선택한다. */
async function chooseFromNativeSelect(page: Page, id: string): Promise<string | null> {
  const selector = `[${MARKER}="${id}"]`;
  const picked = await page.evaluate(
    (sel: string, soldOutSource: string, placeholderSource: string) => {
      const soldOut = new RegExp(soldOutSource, 'i');
      const placeholder = new RegExp(placeholderSource, 'i');
      const el = document.querySelector(sel) as HTMLSelectElement | null;
      if (!el) return null;
      const options = Array.from(el.options).filter(
        (o) => !o.disabled && o.value !== '' && !soldOut.test(o.text) && !placeholder.test(o.text.trim()),
      );
      if (options.length === 0) return null;
      const chosen = options[Math.floor(Math.random() * options.length)];
      return { value: chosen.value, text: chosen.text.trim() };
    },
    selector,
    SOLD_OUT_TEXT.source,
    PLACEHOLDER_TEXT.source,
  );
  if (!picked) return null;

  await page.select(selector, picked.value);
  // 네이버는 change 이벤트로 다음 옵션을 그리므로 직접 쏴준다
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    el?.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector);
  return picked.text;
}

/** 커스텀 드롭다운을 열고 목록에서 하나를 무작위로 클릭한다. */
async function chooseFromDropdown(page: Page, id: string): Promise<string | null> {
  const trigger = await page.$(`[${MARKER}="${id}"]`);
  if (!trigger) return null;

  await crawlerUtil.focus(page, `[${MARKER}="${id}"]`);
  await crawlerUtil.delay(300);
  await trigger.click().catch(() => {});
  await crawlerUtil.delay(800);

  const picked = await page.evaluate(
    (soldOutSource: string, placeholderSource: string) => {
      const soldOut = new RegExp(soldOutSource, 'i');
      const placeholder = new RegExp(placeholderSource, 'i');
      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 20 && rect.height > 5;
      };
      const items = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li'))
        .filter((el) => isVisible(el))
        .filter((el) => el.getAttribute('aria-disabled') !== 'true')
        .map((el) => ({ el, text: String((el as HTMLElement).innerText || '').trim() }))
        .filter((o) => o.text && !soldOut.test(o.text) && !placeholder.test(o.text));
      if (items.length === 0) return null;
      const chosen = items[Math.floor(Math.random() * items.length)];
      chosen.el.setAttribute('data-shs-opt-pick', '1');
      return chosen.text.slice(0, 60);
    },
    SOLD_OUT_TEXT.source,
    PLACEHOLDER_TEXT.source,
  );

  if (!picked) {
    // 목록이 안 열렸으면 열어둔 상태를 되돌린다
    await page.keyboard.press('Escape').catch(() => {});
    return null;
  }

  const item = await page.$('[data-shs-opt-pick="1"]');
  await item?.click().catch(() => {});
  await page.evaluate(() => {
    document.querySelector('[data-shs-opt-pick="1"]')?.removeAttribute('data-shs-opt-pick');
  });
  return picked;
}

/**
 * 옵션 영역 구조를 파일 로그에 남긴다.
 * 셀렉터를 정밀하게 다듬으려면 실제 페이지 구조가 필요해서 첫 시도 때 한 번만 기록한다.
 */
async function captureOptionAreaDiagnostic(page: Page) {
  const summary = await page
    .evaluate(() => {
      const describe = (el: Element) =>
        [
          el.tagName.toLowerCase(),
          el.getAttribute('role') ? `role=${el.getAttribute('role')}` : '',
          el.getAttribute('data-shp-area') ? `shp=${el.getAttribute('data-shp-area')}` : '',
          el.className ? `class=${String(el.className).slice(0, 80)}` : '',
          `text=${String((el as HTMLElement).innerText || '').trim().slice(0, 30)}`,
        ]
          .filter(Boolean)
          .join(' ');

      const selects = Array.from(document.querySelectorAll('select')).map(describe);
      const combos = Array.from(
        document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [class*="option"]'),
      )
        .slice(0, 12)
        .map(describe);
      return { url: location.href, selects, combos };
    })
    .catch(() => null);
  if (!summary) return;
  crawlerUtil.fileLog(`[옵션 영역 진단] ${JSON.stringify(summary)}`);
}

/**
 * 상세페이지 옵션을 최대 maxSelections 개까지 무작위로 골라본다.
 * 조합형 옵션은 하나를 고르면 다음 드롭다운이 생기므로 매번 다시 훑는다.
 */
export async function selectRandomProductOptions(
  page: Page,
  { maxSelections = 3 }: { maxSelections?: number } = {},
): Promise<number> {
  let selectedCount = 0;
  const handledIds: string[] = [];

  try {
    await captureOptionAreaDiagnostic(page);

    for (let round = 0; round < maxSelections; round++) {
      const candidates = await markOptionCandidates(page, handledIds);
      const next = candidates[0];
      if (!next) break;

      handledIds.push(next.id);
      const chosen =
        next.kind === 'select'
          ? await chooseFromNativeSelect(page, next.id)
          : await chooseFromDropdown(page, next.id);

      if (!chosen) continue;

      selectedCount++;
      crawlerUtil.log(`상품 옵션 선택: "${chosen}"`);
      // 고른 뒤 가격·재고가 갱신될 시간을 준다
      await crawlerUtil.waitRandom(page, 2, 4);
    }

    if (selectedCount === 0) crawlerUtil.log('선택할 수 있는 상품 옵션이 없어서 건너뜁니다.');
  } catch (e: any) {
    // 옵션 선택은 부가 동작이라 실패해도 사이클을 끊지 않는다
    crawlerUtil.log('상품 옵션 선택 중 문제가 발생해 건너뜁니다: ' + e?.message);
  } finally {
    await page
      .evaluate((marker: string) => {
        document.querySelectorAll(`[${marker}]`).forEach((el) => el.removeAttribute(marker));
      }, MARKER)
      .catch(() => {});
  }

  return selectedCount;
}
