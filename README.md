# 초키보드 iCloud MCP 서버 · Chalkieboard iCloud MCP

**English.** A local MCP server for [Chalkieboard](https://github.com/207studio/chalkieboard-icloud-mcp), an iPad whiteboard app for elementary teachers.
The app mirrors every subject as a folder in iCloud Drive with a machine-readable `structure.json`. This server gives Claude (or any MCP client)
eight tools over that folder: list subjects, lessons and files; add a material (placed on a lesson automatically by filename); read text files;
append a lesson plan the app imports; create a subject folder. It never deletes and never touches the app's own database — the app only
*appends* from the folder, so a wrong file cannot corrupt lesson data. No network, no telemetry ([PRIVACY.md](PRIVACY.md)).
Zero dependencies, Node 18+. Try it without the app using the [sample folder](sample/). macOS and Windows (iCloud for Windows).


맥의 AI(Claude Desktop · Claude Code 등)가 아이패드 앱의 iCloud 수업 폴더를 읽고, 자료를 놓고, 단원·차시 계획을 덧붙이게 한다.
의존성 0 — Node 18+ 만 있으면 된다.

## 무엇을 하나

| 도구 | 하는 일 |
|---|---|
| `list_subjects` | 과목(바인더) 목록 — 폴더 이름·학년도·학기·단원·차시 수·파일 수, 학급 목록, 폴더 규칙 |
| `list_lessons` | 한 과목(또는 전부)의 단원·차시와 붙은 자료, 기다리는 빠진 파일 |
| `get_lesson` | 차시 하나 — 자료 파일이 폴더에 있는지까지 |
| `list_files` | 과목 폴더의 파일(하위 폴더 포함) — 종류·파일명 배치 정보·학급 표시·앱 연결 여부 |
| `add_material` | 과목 폴더에 pdf·pptx·html 파일 놓기. `unit`·`first`(·`last`)·`grade`를 주면 `학년_학기_단원_차시` 접두를 붙여 그 차시에 자동 배치, `class`를 주면 `(학급)` 꼬리 |
| `read_file` | 과목 폴더의 텍스트 파일 읽기 |
| `plan_lessons` | 배정표(`lessons.chalkie.json`)에 단원·차시·자료 연결 **덧붙이기** — 앱이 다음 훑기에 반영 |
| `create_subject` | 새 과목 폴더 `과목 (학년도-학기)` + 빈 배정표 — 앱이 다음 훑기에 바인더를 만든다 |

리소스: `chalkieboard://structure.json` · `chalkieboard://README.md` · `chalkieboard://<과목 폴더>/lessons.chalkie.json`.

**지우는 도구는 없다.** 삭제는 앱에서만. 이 서버는 앱 저장소(`library.json`)를 건드리지 않는다 —
폴더 → 앱이 덧붙이기 단방향이라 파일 하나 잘못 놓아도 앱 데이터가 깨질 길이 없다.

## 설치

### Claude Desktop — 한 번 클릭(권장)

```bash
./tools/mcp/make_bundle.sh && open -a Claude tools/mcp/dist/chalkieboard.mcpb
```

`.mcpb` 번들은 Claude Desktop이 자기 안에 복사해 두고 **자기 Node로** 띄운다 — 맥에 Node를 깔 필요도, 저장소 경로에 묶일 일도 없다.
서버를 고치면 번들을 다시 만들어 다시 열면 된다(설치창에서 업데이트).

### Claude Code

```bash
claude mcp add --scope user chalkieboard -- node "/Users/jang-yuil/판서어플/tools/mcp/chalkieboard-mcp.mjs"
```

### Claude Desktop — 설정 파일로(번들 대신)

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chalkieboard": {
      "command": "node",
      "args": ["/Users/jang-yuil/판서어플/tools/mcp/chalkieboard-mcp.mjs"]
    }
  }
}
```

폴더는 `~/Library/Mobile Documents/iCloud~only1mui~ChalkieBoard/Documents`에서 찾는다.
다른 곳(시뮬레이터 `-cloudroot` 폴더 등)을 보게 하려면 환경변수 `CHALKIEBOARD_DIR`.

## 전제

- 아이패드 앱이 **구독 상태에서 iCloud에 로그인**돼 있어야 폴더와 `structure.json`이 선다.
- 이 맥이 같은 iCloud 계정이어야 한다. 파일이 아직 안 내려온 항목(`.icloud`)은 목록에 표시만 된다.

## 앱 없이 써 보기

`sample/`에 앱이 쓰는 꼴 그대로의 견본 폴더가 있다(과목 2, 배정표, 학습지 1). 확장 설정의 "수업 폴더"에 고르거나 `CHALKIEBOARD_DIR`로 가리킨다.
심사자·다른 개발자가 아이패드 앱 없이 도구를 돌려 볼 때 쓴다.

## 검사

```bash
node tools/mcp/selftest.mjs
```

임시 폴더에 앱이 쓰는 꼴 그대로 파일을 만들어 도구 전부·경로 탈출 거부·덮어쓰기 거부·배정표 덧붙이기 멱등을 단언한다. 실제 iCloud 폴더는 건드리지 않는다.

## 스토어에 올리기

| 어디 | 누가 싣나 | 준비물 |
|---|---|---|
| 클로드 데스크톱 "확장 찾아보기" | Anthropic 심사(구글 폼 제출) | [디렉터리_제출_초안.md](디렉터리_제출_초안.md) — 아이콘·연락처는 됐고, 공개 저장소·견본 폴더·개인정보 정책 페이지가 남았다 |
| 공개 MCP 레지스트리 | ✅ 올라가 있음 — `io.github.207studio/chalkieboard-icloud-mcp` | 공개 저장소 <https://github.com/207studio/chalkieboard-icloud-mcp>에 태그 `v<버전>`을 밀면 `release.yml`이 번들·릴리스·발행(OIDC) |

아이콘은 앱 아이콘 512px(`icon.png`)이 번들 manifest의 `icon`·`icons`로 들어간다.

공개 저장소는 이 폴더의 **사본**이다 — `export_public.sh`가 `~/chalkieboard-icloud-mcp`로 내보내고(`public/`의 GitHub Actions 포함),
거기서 태그 `v<버전>`을 밀면 `release.yml`이 자가 검사 → 번들 → 릴리스 첨부 → 레지스트리 발행까지 한다. 정본은 언제나 여기(tools/mcp).

