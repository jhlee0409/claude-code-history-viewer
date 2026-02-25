# Multi-stage build for Claude Code History Viewer (WebUI Server Mode)
# Frontend assets are embedded into the binary via rust-embed — no separate dist/ needed.

# ── Stage 1: Build frontend ──────────────────────────────────────────
FROM node:20-slim AS frontend
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prefer-offline
COPY . .
RUN pnpm exec tsc --build . && pnpm exec vite build

# ── Stage 2: Build Rust server binary (with embedded frontend) ──────
FROM rust:1.82-bookworm AS backend
RUN apt-get update && apt-get install -y \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY src-tauri/ src-tauri/
# rust-embed reads dist/ at compile time
COPY --from=frontend /app/dist dist/
WORKDIR /app/src-tauri
RUN cargo build --release --features webui-server

# ── Stage 3: Minimal runtime image ──────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y \
    ca-certificates libwebkit2gtk-4.1-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend /app/src-tauri/target/release/claude-code-history-viewer /usr/local/bin/cchv-server

ENV HOST=0.0.0.0
ENV PORT=3727
EXPOSE 3727

ENTRYPOINT ["cchv-server", "--serve"]
CMD ["--port", "3727"]
