#!/usr/bin/env bash
set -euo pipefail

REPO="wlszddx/shanghai"
APP_DIR="/home/ubuntu/expo-lead-agent"
PORT="4174"
SERVICE="expo-lead-agent"

SHA="${1:-}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "用法: $0 <40 位提交 SHA>"
  echo "示例: $0 a375beb1f325a2e1e57d5ebdac74e5b72583a449"
  exit 1
fi
SHORT="${SHA:0:7}"

if [[ ! -f "$APP_DIR/compose.yaml" ]]; then
  echo "✗ 未找到 $APP_DIR/compose.yaml"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "→ 下载 $REPO@$SHORT"
if ! curl -fL --retry 3 --retry-delay 2 -o "$TMP/src.tar.gz" \
  "https://codeload.github.com/$REPO/tar.gz/$SHA"; then
  echo "✗ 下载失败：确认 $SHORT 已 push 到 GitHub"
  exit 1
fi

tar -xzf "$TMP/src.tar.gz" -C "$TMP"
SRC="$TMP/shanghai-$SHA"
if [[ ! -f "$SRC/app.js" || ! -f "$SRC/Dockerfile" ]]; then
  echo "✗ 压缩包结构异常：$SRC"
  exit 1
fi

BACKUP="$HOME/expo-lead-agent-backups/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp -a "$APP_DIR/app.js" "$APP_DIR/server.js" "$APP_DIR/index.html" "$APP_DIR/styles.css" "$APP_DIR/package.json" "$APP_DIR/Dockerfile" "$BACKUP/"
echo "→ 已备份当前文件到 $BACKUP"

PREV_ID="$(sudo docker compose -f "$APP_DIR/compose.yaml" images -q "$SERVICE" | head -n1 || true)"
if [[ -n "$PREV_ID" ]]; then
  sudo docker tag "$PREV_ID" "expo-lead-agent:previous"
fi

cp "$SRC/app.js" "$SRC/server.js" "$SRC/index.html" "$SRC/styles.css" "$SRC/package.json" "$SRC/Dockerfile" "$APP_DIR/"

cd "$APP_DIR"
echo "→ 构建镜像（$SHORT）"
sudo docker compose build \
  --build-arg GIT_COMMIT="$SHA" \
  --build-arg BUILD_TIME="$STAMP"

echo "→ 启动容器"
sudo docker compose up -d

IMAGE_ID="$(sudo docker compose images -q "$SERVICE" | head -n1 || true)"
if [[ -n "$IMAGE_ID" ]]; then
  sudo docker tag "$IMAGE_ID" "expo-lead-agent:$SHORT"
fi

echo "→ 等待服务就绪"
READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/version" -o "$TMP/version.json" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" -ne 1 ]]; then
  echo "✗ 服务未在 30 秒内就绪"
  sudo docker compose ps
  sudo docker compose logs --tail 30 "$SERVICE"
  exit 1
fi

if ! grep -q "\"$SHA\"" "$TMP/version.json"; then
  echo "✗ 运行版本与目标不一致："
  cat "$TMP/version.json"
  exit 1
fi

echo "✓ LIVE $SHORT ($STAMP)"
echo "  版本: curl -s http://127.0.0.1:$PORT/api/version"
echo "  回滚: sudo docker tag expo-lead-agent:previous expo-lead-agent-expo-lead-agent:latest && sudo docker compose up -d"