#!/bin/zsh
# 초키보드 iCloud MCP → Claude Desktop 한 번 클릭 설치 번들(.mcpb) 만들기 (74차(150-9))
#
# .mcpb는 manifest.json + 서버 파일을 담은 zip이다. 두 번 클릭하면 Claude Desktop이 자기 안에 복사해 두고
# **자기 Node 런타임으로** 띄운다 — 맥에 Node를 따로 깔 필요도, 저장소 경로에 묶일 일도 없다.
# 결과: tools/mcp/dist/chalkieboard.mcpb  (git에 넣지 않는다 — 언제든 다시 만든다)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
version="$(sed -n "s/.*version: '\([0-9.]*\)'.*/\1/p" "$here/chalkieboard-mcp.mjs" | head -1)"
stage="$(mktemp -d)"
mkdir -p "$stage/server" "$here/dist"
cp "$here/chalkieboard-mcp.mjs" "$stage/server/index.mjs"
cp "$here/README.md" "$stage/README.md"
cp "$here/icon.png" "$stage/icon.png"          # 앱 아이콘(512px) — 설치창·확장 목록에 뜬다

# 도구 목록은 서버에 물어서 싣는다 — 손으로 베끼면 반드시 어긋난다.
tools_json="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | CHALKIEBOARD_DIR="$stage" node "$here/chalkieboard-mcp.mjs" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin)["result"]["tools"]; print(json.dumps([{"name":t["name"],"description":t["description"]} for t in r],ensure_ascii=False))')"

python3 - "$stage/manifest.json" "$version" "$tools_json" <<'EOF'
import json,sys
out,version,tools=sys.argv[1],sys.argv[2],json.loads(sys.argv[3])
json.dump({
  "manifest_version": "0.3",
  "name": "chalkieboard-icloud",
  "display_name": "초키보드 iCloud 수업 폴더",
  "version": version,
  "description": "아이패드 초키보드의 iCloud 수업 폴더를 읽고, 자료를 놓고, 단원·차시 계획을 덧붙입니다.",
  "long_description": "읽기는 structure.json, 파일은 과목 폴더(학년_학기_단원_차시 접두로 차시 배치), 계획은 lessons.chalkie.json 덧붙이기. 지우는 도구는 없습니다 — 삭제는 앱에서만. 아이패드 앱이 구독 상태로 iCloud에 로그인돼 있고 이 맥이 같은 계정이어야 합니다.",
  "author": {"name": "only1mui", "email": "only1mui@icloud.com"},
  "homepage": "https://github.com/207studio/chalkieboard-icloud-mcp",
  "documentation": "https://github.com/207studio/chalkieboard-icloud-mcp#readme",
  "privacy_policies": ["https://github.com/207studio/chalkieboard-icloud-mcp/blob/main/PRIVACY.md"],
  "support": "mailto:only1mui@icloud.com",
  "license": "MIT",
  "icon": "icon.png",
  "icons": [{"src": "icon.png", "size": "512x512"}],   # Claude.app 검증 스키마 실측: {src, size, theme?}만 — sizes·mimeType이면 "Invalid manifest"
  "server": {
    "type": "node",
    "entry_point": "server/index.mjs",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.mjs"],
      "env": {"CHALKIEBOARD_DIR": "${user_config.folder}"}
    }
  },
  "tools": tools,
  "user_config": {
    "folder": {
      "type": "directory",
      "title": "수업 폴더(비워 두면 자동)",
      "description": "보통 비워 둡니다 — ~/Library/Mobile Documents/iCloud~only1mui~ChalkieBoard/Documents 를 스스로 찾습니다. 다른 폴더를 보게 할 때만 고릅니다.",
      "required": False
    }
  },
  "keywords": ["chalkieboard", "icloud", "lesson", "teacher"],
  "compatibility": {"platforms": ["darwin", "win32"], "runtimes": {"node": ">=18.0.0"}}
}, open(out,"w"), ensure_ascii=False, indent=2)
EOF

out="$here/dist/chalkieboard.mcpb"
rm -f "$out"
(cd "$stage" && zip -qr "$out" manifest.json server README.md icon.png)
rm -rf "$stage"
echo "만들었습니다: $out ($(du -h "$out" | cut -f1))"
unzip -l "$out" | tail -n +2 | grep -v "^---" | awk 'NF>3{print "  "$4}'
