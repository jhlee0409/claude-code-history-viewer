# 서버 모드 가이드

Claude Code History Viewer를 웹 서버로 실행하세요 — 어디서든 브라우저로 대화 기록을 확인할 수 있습니다.

**Languages**: [English](server-guide.md) | [한국어](server-guide.ko.md)

---

## 목차

- [어떤 방법을 선택해야 하나요?](#어떤-방법을-선택해야-하나요)
- [방법 1: 로컬 + 터널](#방법-1-로컬--터널) — 지금 바로 테스트
- [방법 2: VPS에 설치](#방법-2-vps에-설치) — 상시 운영 추천
- [방법 3: Docker로 VPS 배포](#방법-3-docker로-vps-배포) — Docker 사용자용
- [방법 4: 소스에서 빌드](#방법-4-소스에서-빌드) — 기여자/포크 사용자용
- [설정 레퍼런스](#설정-레퍼런스)
- [문제 해결](#문제-해결)

---

## 어떤 방법을 선택해야 하나요?

| 방법 | 추천 대상 | 난이도 | 비용 |
|------|-----------|--------|------|
| **로컬 + 터널** | 빠른 테스트, 데모 | 쉬움 | 무료 |
| **VPS + 바이너리** | 24/7 원격 접속 | 보통 | ~$5/월 |
| **Docker + VPS** | Docker 익숙한 분 | 보통 | ~$5/월 |
| **소스 빌드** | 기여자, 포크 | 어려움 | ~$5/월 |

---

## 방법 1: 로컬 + 터널

**지금 바로 테스트.** VPS 없이, 카드 등록 없이 사용해볼 수 있습니다.

[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/do-more-with-tunnels/trycloudflare/)을 사용해서 로컬 서버를 인터넷에 무료로 노출합니다.

### 사전 준비

- macOS 또는 Linux
- [Homebrew](https://brew.sh) (macOS) 또는 apt (Linux)

### 진행 순서

**1. cloudflared 설치**

```bash
# macOS
brew install cloudflared

# Ubuntu/Debian
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

**2. 서버 설치 및 실행**

```bash
# Homebrew (추천)
brew install jhlee0409/tap/cchv-server
cchv-server --serve

# 또는 소스에서 빌드
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
just setup
just serve-build-run
```

이런 출력이 나옵니다:

```
🔑 Auth token: e60ed7c7-36ba-4ab8-a6a5-bc9678300b39
   Open in browser: http://192.168.1.10:3727?token=e60ed7c7-...
🚀 WebUI server running at http://0.0.0.0:3727
```

**3. 터널 생성** (새 터미널에서)

```bash
cloudflared tunnel --url http://localhost:3727
```

이런 공개 URL이 나옵니다:

```
https://random-words-here.trycloudflare.com
```

**4. 브라우저에서 접속**

터널 URL과 토큰을 합칩니다:

```
https://random-words-here.trycloudflare.com?token=e60ed7c7-36ba-4ab8-a6a5-bc9678300b39
```

LTE 폰, 다른 컴퓨터 등 어디서든 접속됩니다.

### 제한 사항

- 터널 재시작할 때마다 URL이 바뀜
- 가동 시간 보장 없음 (무료 서비스)
- 상시 접속이 필요하면 방법 2 (VPS) 사용

---

## 방법 2: VPS에 설치

**상시 운영 추천.** 한 번 설정하면 항상 접속 가능합니다.

### 1단계: VPS 만들기

아래 중 하나에 가입하세요. 가장 저렴한 플랜이면 충분합니다:

| 업체 | 링크 | 가격 |
|------|------|------|
| DigitalOcean | [digitalocean.com](https://www.digitalocean.com) | $4/월 |
| Vultr | [vultr.com](https://www.vultr.com) | $3.50/월 |
| Hetzner | [hetzner.com](https://www.hetzner.com) | 3.79€/월 |
| Oracle Cloud | [cloud.oracle.com](https://www.oracle.com/cloud/free/) | **무료** (ARM) |

서버 생성 시:
- **OS**: Ubuntu 22.04 또는 24.04
- **크기**: RAM 1GB이면 충분
- **지역**: 본인과 가까운 곳

생성하면 **공인 IP 주소**를 받습니다 (예: `203.0.113.50`).

### 2단계: VPS에 접속

```bash
ssh root@203.0.113.50
# (본인의 IP로 바꾸세요)
```

### 3단계: cchv-server 설치

```bash
# 방법 A: Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# 방법 B: 설치 스크립트
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

두 방법 모두 OS/아키텍처를 자동 감지해서 `cchv-server`를 PATH에 설치합니다.

### 4단계: Claude 데이터 복사

대화 기록은 로컬 머신의 `~/.claude`에 있습니다. VPS로 복사하세요:

```bash
# 로컬 머신에서 실행 (VPS가 아님!)
rsync -avz ~/.claude root@203.0.113.50:~/.claude
```

Codex CLI, OpenCode 데이터도 함께 복사하려면:

```bash
rsync -avz ~/.claude ~/.codex ~/.local/share/opencode root@203.0.113.50:~/
```

### 5단계: 방화벽 포트 열기

```bash
# VPS에서 실행
sudo ufw allow 3727/tcp
sudo ufw enable
```

> **주의**: DigitalOcean, AWS 등 일부 업체는 웹 콘솔에서도 방화벽(Security Group) 설정이 필요합니다.
> 포트 3727을 허용하세요.

### 6단계: 서버 시작

```bash
cchv-server --serve
```

출력:

```
🔑 Auth token: a1b2c3d4-...
   Open in browser: http://203.0.113.50:3727?token=a1b2c3d4-...
🚀 WebUI server running at http://0.0.0.0:3727
```

브라우저에서 출력된 URL을 열면 끝!

### 7단계: 상시 실행 (systemd)

SSH를 닫으면 서버도 꺼집니다. 항상 켜두려면:

```bash
# 서비스 파일 다운로드
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/contrib/cchv.service | sudo tee /etc/systemd/system/cchv.service > /dev/null

# 편집 — YOUR_USERNAME_HERE를 본인 계정으로 변경
sudo systemctl edit --full cchv.service

# 활성화 및 시작
sudo systemctl enable --now cchv.service

# 상태 확인
sudo systemctl status cchv.service
```

이제 VPS가 재부팅되어도 서버가 자동으로 시작됩니다.

### 8단계: 데이터 자동 동기화 (선택)

로컬에서 새 대화를 할 때마다 VPS에도 반영하고 싶다면:

```bash
# 로컬 머신에서 crontab 편집
crontab -e

# 아래 줄 추가 (30분마다 자동 동기화):
*/30 * * * * rsync -avz ~/.claude root@203.0.113.50:~/.claude --quiet
```

수동으로 동기화할 때:

```bash
rsync -avz ~/.claude root@203.0.113.50:~/.claude
```

---

## 방법 3: Docker로 VPS 배포

Docker를 선호한다면 가장 간편합니다.

### 사전 준비

- Docker가 설치된 VPS ([설치 가이드](https://docs.docker.com/engine/install/ubuntu/))

### 진행 순서

**1. VPS에 접속**

```bash
ssh root@203.0.113.50
```

**2. 클론 및 시작**

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
docker compose up -d
```

**3. 토큰 확인**

```bash
docker compose logs webui
# 🔑 Auth token: ... ← 이 줄을 찾으세요
```

**4. 브라우저에서 접속**

```
http://203.0.113.50:3727?token=여기에_토큰_붙여넣기
```

### 고정 토큰 설정

재시작할 때마다 토큰이 바뀌는 게 불편하면:

```yaml
# docker-compose.yml의 command 수정:
command: ["--port", "3727", "--token", "내-고정-토큰"]
```

---

## 방법 4: 소스에서 빌드

기여자, 포크 관리자, 또는 커스텀 빌드가 필요한 분.

### 사전 준비

- Node.js 18+, pnpm, Rust 툴체인
- 자세한 요구사항: [Build from Source](../README.md#build-from-source)

### 빌드

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
just setup
just serve-build
```

바이너리 위치: `src-tauri/target/release/claude-code-history-viewer`

### VPS에 배포

```bash
# 바이너리를 VPS로 복사
scp src-tauri/target/release/claude-code-history-viewer root@203.0.113.50:/usr/local/bin/cchv-server

# VPS에서 실행
ssh root@203.0.113.50
chmod +x /usr/local/bin/cchv-server
cchv-server --serve
```

### 개발 모드

프론트엔드를 수정하면서 테스트할 때:

```bash
just serve-dev    # dist/ 디렉토리에서 서빙 (내장 아님)
```

코드 수정 → `pnpm build` → 브라우저 새로고침.

---

## 설정 레퍼런스

### CLI 옵션

| 플래그 | 기본값 | 설명 |
|--------|--------|------|
| `--serve` | — | **필수.** 서버 모드 시작 |
| `--port <숫자>` | `3727` | 서버 포트 |
| `--host <주소>` | `0.0.0.0` | 바인드 주소 (`127.0.0.1`이면 로컬 전용) |
| `--token <값>` | 자동 (uuid) | 고정 토큰 지정 |
| `--no-auth` | — | 인증 비활성화 |
| `--dist <경로>` | 내장 에셋 | 외부 dist/ 디렉토리로 오버라이드 |

### 인증

`/api/*` 엔드포인트는 Bearer 토큰이 필요합니다.

| 접근 방법 | 사용법 |
|-----------|--------|
| 브라우저 | `http://host:3727?token=TOKEN` (localStorage에 자동 저장) |
| API / curl | `Authorization: Bearer TOKEN` 헤더 |
| SSE | `http://host:3727/api/events?token=TOKEN` 쿼리 파라미터 |

**팁**: `--token 내-고정-토큰`을 사용하면 재시작해도 토큰이 바뀌지 않습니다. systemd와 함께 쓸 때 특히 유용합니다.

### 실시간 업데이트

서버가 `~/.claude/projects/`를 감시하고 파일이 바뀌면 SSE로 브라우저에 푸시합니다. Claude Code를 사용하면 뷰어가 자동으로 업데이트됩니다.

### 헬스체크

```
GET /health
→ { "status": "ok", "version": "1.5.3", "uptime_secs": 120 }
```

---

## 문제 해결

### "접속할 수 없음" — 다른 기기에서 안 열림

| 원인 | 해결 |
|------|------|
| 서버가 꺼져 있음 | `systemctl status cchv.service` 확인 |
| IP 주소가 틀림 | VPS의 **공인 IP**를 사용 (`0.0.0.0`이나 `192.168.x.x`가 아님) |
| 방화벽이 포트 차단 | `sudo ufw allow 3727/tcp` + VPS 업체 보안그룹 확인 |
| 포트가 이미 사용 중 | `lsof -ti :3727 \| xargs kill` 또는 `--port 3728` |

### "401 Unauthorized" — 인증 오류

토큰이 틀리거나 빠져 있습니다:
1. URL에 `?token=올바른_토큰` 확인
2. 서버 로그에서 `🔑 Auth token: ...` 확인
3. 서버 재시작 시 토큰이 바뀜 → `--token` 플래그로 고정

### 같은 WiFi에서는 되는데 LTE에서 안 됨

서버가 **로컬 머신**에서 실행 중입니다. 로컬 IP(`192.168.x.x`)는 인터넷에서 접근할 수 없습니다.

해결:
1. [방법 1 (터널)](#방법-1-로컬--터널) — 임시 접속
2. [방법 2 (VPS)](#방법-2-vps에-설치) — 상시 접속

### VPS에서 "No Claude data found"

`~/.claude`를 로컬에서 VPS로 복사해야 합니다:

```bash
rsync -avz ~/.claude root@VPS_IP:~/.claude
```

### HTTPS / SSL 적용

서버는 기본 HTTP입니다. HTTPS가 필요하면 리버스 프록시를 사용하세요:

```bash
# Caddy로 간단하게 HTTPS 적용 (인증서 자동 발급)
sudo apt install -y caddy
echo "your-domain.com { reverse_proxy localhost:3727 }" | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

이후 `https://your-domain.com?token=...`으로 접속.
