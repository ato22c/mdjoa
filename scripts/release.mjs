#!/usr/bin/env node
// "한 줄 배포 빌드" — `npm run release` 한 줄로 현재 컴퓨터에 맞는 설치파일을 만든다.
//  - 맥에서 실행하면  → .dmg / .app (맥용)
//  - 윈도우에서 실행하면 → .exe (윈도우용, NSIS)
// (한 컴퓨터에서 두 OS용을 동시에 만들 수는 없다 — 각 OS에서 한 번씩 실행한다.)
import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const isWin = platform() === "win32";
const isMac = platform() === "darwin";
const osLabel = isWin ? "윈도우" : isMac ? "맥" : "이 OS";

console.log(`\n📦 ${osLabel}용 설치파일을 만드는 중이에요... 몇 분 걸려요. 기다려 주세요.\n`);

// npm 으로 들어온 추가 인자(예: npm run release -- --target ...)를 그대로 넘긴다.
const extra = process.argv.slice(2);
const res = spawnSync("npx", ["tauri", "build", ...extra], {
  stdio: "inherit",
  shell: true,
});

if (res.status !== 0) {
  console.error("\n❌ 만들기에 실패했어요. 위에 빨간 메시지를 확인하거나 담당자에게 알려주세요.\n");
  process.exit(res.status ?? 1);
}

const base = "src-tauri/target/release/bundle";
const where = isWin
  ? `${base}\\nsis\\   ← 여기 .exe 설치파일이 있어요`
  : isMac
    ? `${base}/dmg/    ← 여기 .dmg 설치파일이 있어요`
    : `${base}/`;

console.log(`\n✅ 다 됐어요! ${osLabel}용 설치파일 위치:\n   ${where}\n`);
console.log("이 파일을 사내에 올려두면 사람들이 받아서 설치할 수 있어요.\n");
