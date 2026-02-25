# Server Mode Guide

Run Claude Code History Viewer as a web server — access your conversation history from any browser, anywhere.

**Languages**: [English](server-guide.md) | [한국어](server-guide.ko.md)

---

## Table of Contents

- [Which method is right for me?](#which-method-is-right-for-me)
- [Method 1: Local + Tunnel](#method-1-local--tunnel) — Try it now, no VPS needed
- [Method 2: VPS with pre-built binary](#method-2-vps-with-pre-built-binary) — Recommended for production
- [Method 3: Docker on VPS](#method-3-docker-on-vps) — For Docker users
- [Method 4: Build from source](#method-4-build-from-source) — For contributors and forks
- [Configuration reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)

---

## Which method is right for me?

| Method | Best for | Difficulty | Cost |
|--------|----------|------------|------|
| **Local + Tunnel** | Quick test, demo | Easy | Free |
| **VPS + Binary** | 24/7 remote access | Medium | ~$5/mo |
| **Docker on VPS** | Docker-familiar users | Medium | ~$5/mo |
| **Build from source** | Contributors, forks | Advanced | ~$5/mo |

---

## Method 1: Local + Tunnel

**Try server mode right now** from your local machine. No VPS, no credit card.

Uses [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/do-more-with-tunnels/trycloudflare/) to expose your local server to the internet for free.

### Prerequisites

- macOS or Linux
- [Homebrew](https://brew.sh) (macOS) or apt (Linux)

### Steps

**1. Install cloudflared**

```bash
# macOS
brew install cloudflared

# Ubuntu/Debian
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

**2. Install and start the server**

```bash
# Homebrew (recommended)
brew install jhlee0409/tap/cchv-server
cchv-server --serve

# Or build from source
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
just setup
just serve-build-run
```

You'll see output like:

```
🔑 Auth token: e60ed7c7-36ba-4ab8-a6a5-bc9678300b39
   Open in browser: http://192.168.1.10:3727?token=e60ed7c7-...
🚀 WebUI server running at http://0.0.0.0:3727
```

**3. Create a tunnel** (in a new terminal)

```bash
cloudflared tunnel --url http://localhost:3727
```

You'll get a public URL like:

```
https://random-words-here.trycloudflare.com
```

**4. Open in browser**

Combine the tunnel URL with your token:

```
https://random-words-here.trycloudflare.com?token=e60ed7c7-36ba-4ab8-a6a5-bc9678300b39
```

This works from any device — phone on LTE, another computer, anywhere.

### Limitations

- URL changes every time you restart the tunnel
- No uptime guarantee (it's a free service)
- For permanent access, use a VPS (Method 2)

---

## Method 2: VPS with pre-built binary

**Recommended for production.** One-time setup, always accessible.

### Step 1: Get a VPS

Sign up with any VPS provider. Budget options (~$5/month):

| Provider | Link | Notes |
|----------|------|-------|
| DigitalOcean | [digitalocean.com](https://www.digitalocean.com) | $4/mo Droplet |
| Vultr | [vultr.com](https://www.vultr.com) | $3.50/mo |
| Hetzner | [hetzner.com](https://www.hetzner.com) | 3.79€/mo (Europe) |
| Oracle Cloud | [cloud.oracle.com](https://www.oracle.com/cloud/free/) | Free tier (ARM) |

When creating a server:
- **OS**: Ubuntu 22.04 or 24.04
- **Size**: 1 GB RAM is enough
- **Region**: Choose closest to you

After creation, you'll get a **public IP address** (e.g., `203.0.113.50`).

### Step 2: Connect to your VPS

```bash
ssh root@203.0.113.50
# (Replace with your actual IP)
```

### Step 3: Install cchv-server

```bash
# Option A: Homebrew (macOS / Linux)
brew install jhlee0409/tap/cchv-server

# Option B: One-line install script
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
```

Both methods auto-detect your OS/architecture and install `cchv-server` to your PATH.

### Step 4: Copy your Claude data

Your conversation history is in `~/.claude` on your local machine. Copy it to the VPS:

```bash
# Run this on your LOCAL machine (not the VPS)
rsync -avz ~/.claude root@203.0.113.50:~/.claude
```

Or for all providers:

```bash
rsync -avz ~/.claude ~/.codex ~/.local/share/opencode root@203.0.113.50:~/
```

### Step 5: Open the firewall port

```bash
# On the VPS — allow port 3727
sudo ufw allow 3727/tcp
sudo ufw enable
```

> **Note**: Some VPS providers also have a web-based firewall (Security Groups, Firewall Rules).
> Make sure port 3727 is allowed there too.

### Step 6: Start the server

```bash
cchv-server --serve
```

Output:

```
🔑 Auth token: a1b2c3d4-...
   Open in browser: http://203.0.113.50:3727?token=a1b2c3d4-...
🚀 WebUI server running at http://0.0.0.0:3727
```

Open the URL in your browser. Done!

### Step 7: Keep it running (systemd)

The server stops when you close SSH. To keep it running permanently:

```bash
# Copy the service file
sudo cp /usr/local/bin/cchv.service /etc/systemd/system/ 2>/dev/null || \
curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/contrib/cchv.service | sudo tee /etc/systemd/system/cchv.service > /dev/null

# Edit — change YOUR_USERNAME_HERE to your actual username
sudo systemctl edit --full cchv.service

# Enable and start
sudo systemctl enable --now cchv.service

# Check status
sudo systemctl status cchv.service
```

Now the server starts automatically on boot.

### Step 8: Keep data in sync (optional)

To automatically sync new conversations from your local machine to the VPS:

```bash
# Add to your crontab on your LOCAL machine (runs every 30 minutes)
crontab -e

# Add this line:
*/30 * * * * rsync -avz ~/.claude root@203.0.113.50:~/.claude --quiet
```

Or sync manually whenever you want:

```bash
rsync -avz ~/.claude root@203.0.113.50:~/.claude
```

---

## Method 3: Docker on VPS

If you prefer Docker, this is the easiest setup on a VPS.

### Prerequisites

- A VPS with Docker installed ([install guide](https://docs.docker.com/engine/install/ubuntu/))

### Steps

**1. SSH into your VPS**

```bash
ssh root@203.0.113.50
```

**2. Clone and start**

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer
docker compose up -d
```

**3. Get the token**

```bash
docker compose logs webui
# Look for: 🔑 Auth token: ...
```

**4. Open in browser**

```
http://203.0.113.50:3727?token=YOUR_TOKEN_HERE
```

### Docker Compose configuration

The included `docker-compose.yml` mounts these directories as read-only:
- `~/.claude` — Claude Code conversations
- `~/.codex` — Codex CLI conversations
- `~/.local/share/opencode` — OpenCode conversations

To use a fixed token (so it doesn't change on restart):

```yaml
# docker-compose.yml — add to the command section:
command: ["--port", "3727", "--token", "my-secret-token"]
```

---

## Method 4: Build from source

For contributors, fork maintainers, or custom builds.

### Prerequisites

- Node.js 18+, pnpm, Rust toolchain
- See [Build from Source](../README.md#build-from-source) for detailed requirements

### Steps

```bash
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer

# Install dependencies
just setup

# Build server binary (frontend is embedded automatically)
just serve-build
```

The binary is at `src-tauri/target/release/claude-code-history-viewer`.

### Deploy to VPS

```bash
# Copy binary to VPS
scp src-tauri/target/release/claude-code-history-viewer root@203.0.113.50:/usr/local/bin/cchv-server

# SSH in and start
ssh root@203.0.113.50
chmod +x /usr/local/bin/cchv-server
cchv-server --serve
```

### Development mode

For working on the frontend with live changes:

```bash
just serve-dev    # Serves from dist/ directory, not embedded
```

Edit frontend code → `pnpm build` → refresh browser.

---

## Configuration reference

### CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--serve` | — | **Required.** Start server mode |
| `--port <number>` | `3727` | Server port |
| `--host <address>` | `0.0.0.0` | Bind address (`127.0.0.1` for local only) |
| `--token <value>` | auto (uuid) | Set a fixed auth token |
| `--no-auth` | — | Disable authentication |
| `--dist <path>` | embedded | Serve frontend from filesystem instead of embedded |

### Authentication

All `/api/*` endpoints require a Bearer token. The token is auto-generated on each start.

| Access method | How |
|---------------|-----|
| Browser | `http://host:3727?token=TOKEN` (auto-saved to localStorage) |
| API / curl | `Authorization: Bearer TOKEN` header |
| SSE (EventSource) | `http://host:3727/api/events?token=TOKEN` query param |

**Tip**: Use `--token my-fixed-token` for a persistent token that doesn't change between restarts. Especially useful with systemd.

### Real-time updates

The server watches `~/.claude/projects/` and pushes file changes to the browser via SSE. When you use Claude Code, the viewer updates automatically.

### Health check

```
GET /health
→ { "status": "ok", "version": "1.5.3", "uptime_secs": 120 }
```

---

## Troubleshooting

### "Connection refused" from another device

| Cause | Fix |
|-------|-----|
| Server not running | Check `systemctl status cchv.service` or start manually |
| Wrong IP address | Use your VPS's **public IP**, not `0.0.0.0` or `192.168.x.x` |
| Firewall blocking port | `sudo ufw allow 3727/tcp` and check VPS provider's security group |
| Port already in use | `lsof -ti :3727 \| xargs kill` or use `--port 3728` |

### "401 Unauthorized"

The token is wrong or missing. Check:
1. Token in URL: `?token=CORRECT_TOKEN`
2. Token in API header: `Authorization: Bearer CORRECT_TOKEN`
3. Server logs show the token at startup (`🔑 Auth token: ...`)

### Can't access from phone (LTE) but works on same WiFi

Your server is on a **local machine**, not a VPS. Local machines have private IPs (`192.168.x.x`) that aren't reachable from the internet. Options:
1. Use [Method 1 (Tunnel)](#method-1-local--tunnel) for temporary access
2. Use [Method 2 (VPS)](#method-2-vps-with-pre-built-binary) for permanent access

### "No Claude data found" on VPS

You need to copy `~/.claude` from your local machine to the VPS:

```bash
rsync -avz ~/.claude root@YOUR_VPS_IP:~/.claude
```

### High memory usage

The server is lightweight (~30 MB), but scanning large conversation histories can spike memory temporarily. 1 GB RAM is sufficient for most users.

### HTTPS / SSL

The server runs plain HTTP. For HTTPS, use a reverse proxy:

```bash
# Quick HTTPS with Caddy (auto-certificates)
sudo apt install -y caddy
echo "your-domain.com { reverse_proxy localhost:3727 }" | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Then access via `https://your-domain.com?token=...`.
