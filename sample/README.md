# Sample lesson folder / 견본 수업 폴더

A tiny copy of what the Chalkieboard iPad app writes to iCloud Drive, for trying the MCP server without the app.
Point the server at this folder:

- Claude Desktop extension: settings → "수업 폴더" → choose this `sample` directory.
- Command line: `CHALKIEBOARD_DIR=/path/to/sample node chalkieboard-mcp.mjs`

Contents: `structure.json` (index the app writes), two subject folders `수학 (2026-2)` and `과학 (2026-2)`, each with a `lessons.chalkie.json` sheet, and one worksheet whose name `4_2_1_01_학습지.html` places it on unit 1 lesson 1.

초키보드 앱 없이 서버를 써 보기 위한 견본입니다. 확장 설정의 "수업 폴더"에 이 `sample` 폴더를 고르거나 `CHALKIEBOARD_DIR`로 가리키세요.
