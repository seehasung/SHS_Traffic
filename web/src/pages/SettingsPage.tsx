import { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  NumberInput,
  NumberInputField,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  useToast,
} from '@chakra-ui/react';
import type { Settings, KnowledgeMode } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import { api } from '@/api';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Text fontWeight="bold" fontSize="sm" color="blue.600" mb={3}>
        {title}
      </Text>
      <Stack spacing={4}>{children}</Stack>
    </Box>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <FormControl>
      <FormLabel fontSize="sm" mb={1}>
        {label}
      </FormLabel>
      {children}
    </FormControl>
  );
}

function SettingsForm({ mode }: { mode: KnowledgeMode }) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    api.settings.get(mode).then(setS);
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.settings.save(s, mode);
      setS(next);
      toast({ title: '저장되었습니다', status: 'success', position: 'top' });
    } catch (e: any) {
      toast({ title: e?.message ?? String(e), status: 'error', position: 'top' });
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS({ ...s, [key]: value });
  const isBlog = mode === 'blog';

  return (
      <Box borderWidth="1px" borderRadius="lg" p={6}>
        <Stack spacing={6}>

          {/* ── IP 변경 방식 ── */}
          <Section title="아이피 변경">
            <Field label="아이피 변경 방식">
              <RadioGroup value={s.ipChangeType} onChange={(v) => set('ipChangeType', v as Settings['ipChangeType'])}>
                <HStack spacing={5}>
                  <Radio value="phone">테더링</Radio>
                  <Radio value="vpn">VPN</Radio>
                  <Radio value="none">변경 안 함</Radio>
                </HStack>
              </RadioGroup>
            </Field>

            {s.ipChangeType === 'vpn' && (
              <>
                <Field label="VPN 프로그램 설정">
                  <RadioGroup value={s.vpnType ?? 'cool'} onChange={(v) => set('vpnType', v as Settings['vpnType'])}>
                    <HStack spacing={5}>
                      <Radio value="hi">하이아이피</Radio>
                      <Radio value="cool">쿨아이피</Radio>
                      <Radio value="momo">모모아이피</Radio>
                    </HStack>
                  </RadioGroup>
                </Field>

                {s.vpnType === 'hi' && (
                  <HStack spacing={4}>
                    <Field label="서비스 번호">
                      <NumberInput
                        value={s.서비스번호 ?? ''}
                        min={1}
                        onChange={(_, v) => set('서비스번호', v || undefined)}
                      >
                        <NumberInputField />
                      </NumberInput>
                    </Field>
                    <Field label="상품 번호">
                      <NumberInput
                        value={s.상품번호 ?? ''}
                        min={1}
                        onChange={(_, v) => set('상품번호', v || undefined)}
                      >
                        <NumberInputField />
                      </NumberInput>
                    </Field>
                  </HStack>
                )}
              </>
            )}

            <Field label="MAC 주소 변경">
              <RadioGroup value={s.macAddressChange ?? 'N'} onChange={(v) => set('macAddressChange', v as Settings['macAddressChange'])}>
                <HStack spacing={5}>
                  <Radio value="Y">변경함</Radio>
                  <Radio value="N">변경안함</Radio>
                </HStack>
              </RadioGroup>
            </Field>
          </Section>

          <Divider />

          {/* ── 브라우저 / 페이지 설정 ── */}
          <Section title="브라우저 설정">
            <Field label="스크롤 속도 설정">
              <RadioGroup value={s.scrollSpeed ?? 'normal'} onChange={(v) => set('scrollSpeed', v as Settings['scrollSpeed'])}>
                <HStack spacing={5}>
                  <Radio value="fast">빠름</Radio>
                  <Radio value="normal">중간</Radio>
                  <Radio value="slow">느림</Radio>
                </HStack>
              </RadioGroup>
            </Field>

            <Field label="작업 페이지 유형">
              <RadioGroup value={s.pageType} onChange={(v) => set('pageType', v as Settings['pageType'])}>
                <HStack spacing={5}>
                  <Radio value="pc">PC</Radio>
                  <Radio value="mobile">MOBILE</Radio>
                  <Radio value="random">PC + MOBILE 랜덤</Radio>
                </HStack>
              </RadioGroup>
            </Field>

            <Field label="크롬 브라우저">
              <RadioGroup value={s.showBrowser ?? 'Y'} onChange={(v) => set('showBrowser', v as Settings['showBrowser'])}>
                <HStack spacing={5}>
                  <Radio value="Y">열기</Radio>
                  <Radio value="N">열지않음</Radio>
                </HStack>
              </RadioGroup>
            </Field>

            <Field label="이미지 표시">
              <RadioGroup value={s.showImage ?? 'Y'} onChange={(v) => set('showImage', v as Settings['showImage'])}>
                <HStack spacing={5}>
                  <Radio value="Y">허용</Radio>
                  <Radio value="N">허용안함</Radio>
                </HStack>
              </RadioGroup>
            </Field>
          </Section>

          <Divider />

          <Section title="작업 방식">
            <Field label="작업 방식">
              <RadioGroup value={s.testMode} onChange={(v) => set('testMode', v as Settings['testMode'])}>
                <Stack spacing={1}>
                  <Radio value="N">일반 (IP변경·검색기록·쿠키삭제 적용)</Radio>
                  <Radio value="Y">테스트 (IP변경·검색기록·쿠키삭제 미사용)</Radio>
                </Stack>
              </RadioGroup>
            </Field>

            <Field label="광고상품 클릭">
              <RadioGroup value={s.isIncludeAds ?? 'Y'} onChange={(v) => set('isIncludeAds', v as Settings['isIncludeAds'])}>
                <HStack spacing={5}>
                  <Radio value="Y">광고상품 포함</Radio>
                  <Radio value="N">광고상품 미포함</Radio>
                </HStack>
              </RadioGroup>
            </Field>

            <Field label="로그 유형">
              <RadioGroup value={s.logType} onChange={(v) => set('logType', v as Settings['logType'])}>
                <HStack spacing={5}>
                  <Radio value="no-save">사이클당 초기화</Radio>
                  <Radio value="save-init">사이클당 로그 저장 후 초기화</Radio>
                </HStack>
              </RadioGroup>
            </Field>
          </Section>

          <Divider />

          <Section title="네이버 / 로그인">
            <Field label="네이버 로그인">
              <RadioGroup value={s.naverLoginType} onChange={(v) => set('naverLoginType', v as Settings['naverLoginType'])}>
                <HStack spacing={5}>
                  <Radio value="inOrder">순서대로</Radio>
                  <Radio value="random">랜덤하게</Radio>
                  <Radio value="no">작업안함</Radio>
                </HStack>
              </RadioGroup>
            </Field>
          </Section>

          <Divider />

          {!isBlog && (
            <>
              <Section title="상위 영역">
                <Field label="상위 영역">
                  <RadioGroup value={s.storeType ?? 'normal'} onChange={(v) => set('storeType', v as Settings['storeType'])}>
                    <HStack spacing={5}>
                      <Radio value="normal">가격비교1</Radio>
                      <Radio value="special">가격비교2</Radio>
                      <Radio value="plus">+스토어</Radio>
                    </HStack>
                  </RadioGroup>
                </Field>
              </Section>

              <Divider />
            </>
          )}

          <Section title="로직 / 체류시간">
            <Field label="로직 유형">
              <RadioGroup value={s.logicType} onChange={(v) => set('logicType', v as Settings['logicType'])}>
                <HStack spacing={5}>
                  <Radio value="detail">정밀로직</Radio>
                  <Radio value="clean">클린로직</Radio>
                  {!isBlog && <Radio value="hidden">히든로직</Radio>}
                </HStack>
              </RadioGroup>
            </Field>

            {!isBlog && (
              <Field label="쇼핑랜덤서핑">
                <RadioGroup value={s.shoppingRandomSearch ?? 'N'} onChange={(v) => set('shoppingRandomSearch', v as Settings['shoppingRandomSearch'])}>
                  <HStack spacing={5}>
                    <Radio value="Y">추가함</Radio>
                    <Radio value="N">추가안함</Radio>
                  </HStack>
                </RadioGroup>
              </Field>
            )}

            <HStack spacing={4} align="flex-end">
              <Field label="체류시간 (1차반영) — 최소">
                <HStack>
                  <NumberInput size="sm" w="100px" value={s.minWaitTime1} min={0} onChange={(_, v) => set('minWaitTime1', v || 0)}>
                    <NumberInputField />
                  </NumberInput>
                  <Text fontSize="sm" color="gray.500">초</Text>
                </HStack>
              </Field>
              <Field label="최대">
                <HStack>
                  <NumberInput size="sm" w="100px" value={s.maxWaitTime1} min={0} onChange={(_, v) => set('maxWaitTime1', v || 0)}>
                    <NumberInputField />
                  </NumberInput>
                  <Text fontSize="sm" color="gray.500">초</Text>
                </HStack>
              </Field>
            </HStack>

            <HStack spacing={4} align="flex-end">
              <Field label="체류시간 (2차반영) — 최소">
                <HStack>
                  <NumberInput size="sm" w="100px" value={s.minWaitTime2} min={0} onChange={(_, v) => set('minWaitTime2', v || 0)}>
                    <NumberInputField />
                  </NumberInput>
                  <Text fontSize="sm" color="gray.500">초</Text>
                </HStack>
              </Field>
              <Field label="최대">
                <HStack>
                  <NumberInput size="sm" w="100px" value={s.maxWaitTime2} min={0} onChange={(_, v) => set('maxWaitTime2', v || 0)}>
                    <NumberInputField />
                  </NumberInput>
                  <Text fontSize="sm" color="gray.500">초</Text>
                </HStack>
              </Field>
            </HStack>
          </Section>

          {/* ── 최대 검색 페이지 ── */}
          {mode === 'shopping' && (
            <Section title="최대 검색 페이지">
              <Field label="상품 검색 시 최대 페이지 수">
                <HStack>
                  <NumberInput size="sm" w="100px" value={s.maxPages ?? 200} min={1} max={500} onChange={(_, v) => set('maxPages', v || 200)}>
                    <NumberInputField />
                  </NumberInput>
                  <Text fontSize="sm" color="gray.500">페이지</Text>
                </HStack>
              </Field>
            </Section>
          )}

          {/* ── 저장 버튼 ── */}
          <HStack justify="flex-end" pt={2}>
            <Button onClick={save} colorScheme="blue" size="lg" px={10} isLoading={busy}>
              저장하기
            </Button>
          </HStack>
        </Stack>
      </Box>
  );
}

export default function SettingsPage() {
  return (
    <Stack spacing={6}>
      <Heading size="md">작업 설정</Heading>
      <Tabs variant="enclosed" colorScheme="blue">
        <TabList>
          <Tab>상품 설정 (쇼핑)</Tab>
          <Tab>사이트 설정 (블로그)</Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <SettingsForm mode="shopping" />
          </TabPanel>
          <TabPanel px={0}>
            <SettingsForm mode="blog" />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Stack>
  );
}
