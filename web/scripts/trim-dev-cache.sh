#!/bin/zsh
# Safety net for the Next.js dev server's Turbopack cache (.next/dev).
# turbopackFileSystemCacheForDev is disabled in next.config.ts, so this
# directory shouldn't reappear/grow under normal operation — this just
# guards against it creeping back (e.g. a config revert, a Next.js
# upgrade that re-enables it, or a corrupted .next/cache).
set -euo pipefail

WEB_DIR="/Users/christophermccallum/Personal-Vibe-Coding/Github/stock-picker/web"
DEV_CACHE="$WEB_DIR/.next/dev"
THRESHOLD_KB=$((400 * 1024)) # 400MB
AGENT_LABEL="com.stockpicker.webdev"
AGENT_PLIST="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"

if [ ! -d "$DEV_CACHE" ]; then
  echo "$(date '+%F %T'): .next/dev absent — nothing to trim"
  exit 0
fi

SIZE_KB=$(du -sk "$DEV_CACHE" | cut -f1)

if [ "$SIZE_KB" -le "$THRESHOLD_KB" ]; then
  echo "$(date '+%F %T'): .next/dev is ${SIZE_KB}KB, within ${THRESHOLD_KB}KB threshold — no action"
  exit 0
fi

echo "$(date '+%F %T'): .next/dev is ${SIZE_KB}KB, exceeds ${THRESHOLD_KB}KB — trimming"

launchctl bootout "gui/$(id -u)/${AGENT_LABEL}" 2>/dev/null || true
sleep 2
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

rm -rf "$DEV_CACHE"

launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST"
echo "$(date '+%F %T'): trim complete, ${AGENT_LABEL} restarted"
