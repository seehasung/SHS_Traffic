# VPN 템플릿 이미지

이 폴더에 VPN 프로그램 UI 자동화에 사용되는 템플릿 PNG 이미지를 넣어주세요.
원본 프로그램에서 사용하던 이미지를 동일하게 복사하면 됩니다.

## 디렉토리 구조

```
resources/
├── hi/          (하이아이피)
│   ├── thumbnail.png
│   ├── chat.png
│   ├── option.png
│   ├── error.png
│   ├── wait-after-enter.png
│   ├── check.png
│   ├── close.png
│   ├── close-ok.png
│   ├── logout.png
│   ├── yes.png
│   └── ok.png
├── cool/        (쿨아이피)
│   ├── thumbnail.png
│   ├── login.png
│   ├── caution-after-login.png
│   ├── caution-ok.png
│   ├── error-after-login.png
│   ├── wait-after-enter.png
│   ├── all-check.png
│   ├── logout.png
│   └── logout-after.png
└── momo/        (모모아이피)
    ├── thumbnail.png
    ├── login.png
    ├── already-login.png
    ├── already-login-yes.png
    ├── wait-after-enter.png
    ├── all-check.png
    ├── logout.png
    └── logout-after.png
```

## 중요

- 모든 이미지는 PNG 형식이어야 합니다.
- 이미지는 VPN 프로그램 화면의 특정 버튼/상태를 캡처한 것입니다.
- nut-js의 template matching (confidence 0.95~0.99)으로 인식하므로 정확한 이미지가 필요합니다.
