/**
 * 模擬 Goose 事件流 — 用於驗證 GooseOffice 端對端流程。
 *
 * 用法：
 *   cd webview-ui && npx tsx ../server/simulate-goose.ts
 *
 * 會逐行寫入 JSONL 到 MobileGoose/tmp/goose-events-simulate.jsonl，
 * 每個事件間有延遲，模擬真實的 Goose 執行節奏。
 * 同時開著 npm run dev 的瀏覽器頁面，觀察 Tester 角色的反應。
 */

import * as fs from 'fs';
import * as path from 'path';

const outDir = process.env.GOOSE_WATCH_DIR;
if (!outDir) {
  console.error('錯誤：請設定 GOOSE_WATCH_DIR 環境變數，例如：');
  console.error('  GOOSE_WATCH_DIR=/path/to/sessions npx tsx server/simulate-goose.ts');
  process.exit(1);
}
const testrun = 'STTL-181126_simulate';
const outFile = path.join(outDir, `goose-events-${testrun}.jsonl`);

fs.mkdirSync(outDir, { recursive: true });

// 清空舊檔
fs.writeFileSync(outFile, '');

function now(): string {
  return new Date().toISOString();
}

function write(event: Record<string, unknown>): void {
  const line = JSON.stringify({ ...event, ts: now() }) + '\n';
  fs.appendFileSync(outFile, line);
  console.log(`  → ${event.type as string}: ${(event.toolName as string) ?? (event.goal as string) ?? (event.reason as string) ?? ''}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log(`\n模擬 Goose 事件流`);
  console.log(`輸出: ${outFile}`);
  console.log(`請確認 npm run dev 正在執行，然後開啟瀏覽器觀察 Tester 角色\n`);

  // ── Session 開始 ───────────────────────────────────────────────
  write({ type: 'session_start', provider: 'github_copilot', model: 'gpt-4.1', testrun });
  await sleep(2000);

  // ── 讀取測試案例 ──────────────────────────────────────────────
  write({ type: 'tool_start', toolId: 't1', toolName: 'get_testcase_details', extension: 'mcp-ta2' });
  await sleep(500);
  write({ type: 'tool_args', toolId: 't1', key: 'testcase_id', value: 'STTL-181126' });
  await sleep(3000);
  write({ type: 'tool_end', toolId: 't1', toolName: 'get_testcase_details', extension: 'mcp-ta2' });
  await sleep(1000);

  // ── 寫 TODO ────────────────────────────────────────────────────
  write({ type: 'tool_start', toolId: 't2', toolName: 'todo_write', extension: 'todo' });
  await sleep(500);
  write({ type: 'tool_args', toolId: 't2', key: 'content', value: '- [x] STTL-181126 語言切換測試' });
  await sleep(2000);
  write({ type: 'tool_end', toolId: 't2', toolName: 'todo_write', extension: 'todo' });
  await sleep(1500);

  // ── 派出 DroidRun 連 WiFi ────────────────────────────────────
  write({ type: 'tool_start', toolId: 't3', toolName: 'shell', extension: 'developer' });
  await sleep(500);
  write({ type: 'tool_args', toolId: 't3', key: 'command', value: 'python run-test.py "Connect to WiFi"' });
  await sleep(3000);

  write({ type: 'droidrun_plan', parentToolId: 't3', goal: 'Connect to WiFi' });
  await sleep(2000);

  write({ type: 'droidrun_action', parentToolId: 't3', step: 1, maxSteps: 50, think: 'Opening WiFi settings', decision: 'open_settings — Open WiFi settings (2609ms)' });
  await sleep(3000);

  write({ type: 'droidrun_action', parentToolId: 't3', step: 2, maxSteps: 50, think: 'WiFi already connected to ST_Public', decision: 'done — WiFi connected (2202ms)' });
  await sleep(1500);

  write({ type: 'droidrun_result', parentToolId: 't3', success: true, message: 'WiFi connected to ST_Public', totalSteps: 2 });
  await sleep(1000);
  write({ type: 'droidrun_log', path: 'logs/simulate-wifi.json' });
  await sleep(500);
  write({ type: 'tool_end', toolId: 't3', toolName: 'shell', extension: 'developer' });
  await sleep(2000);

  // ── 派出 DroidRun 開 Settings ────────────────────────────────
  write({ type: 'tool_start', toolId: 't4', toolName: 'shell', extension: 'developer' });
  await sleep(500);
  write({ type: 'tool_args', toolId: 't4', key: 'command', value: 'python run-test.py "Open Settings and go to Languages"' });
  await sleep(3000);

  write({ type: 'droidrun_plan', parentToolId: 't4', goal: 'Open Settings and go to Languages' });
  await sleep(2000);

  write({ type: 'droidrun_action', parentToolId: 't4', step: 1, maxSteps: 50, think: 'Looking for Settings app', decision: 'find_and_tap — Tap Settings icon (3470ms)' });
  await sleep(3000);

  write({ type: 'droidrun_action', parentToolId: 't4', step: 2, maxSteps: 50, think: 'Settings open, navigate to System', decision: 'tap — Tap System (1934ms)' });
  await sleep(2500);

  write({ type: 'droidrun_action', parentToolId: 't4', step: 3, maxSteps: 50, think: 'In System, tap Languages & input', decision: 'tap — Tap Languages & input (3007ms)' });
  await sleep(3000);

  write({ type: 'droidrun_action', parentToolId: 't4', step: 4, maxSteps: 50, think: 'Languages section open', decision: 'done — Languages & input section reached (1579ms)' });
  await sleep(1500);

  write({ type: 'droidrun_result', parentToolId: 't4', success: true, message: 'Languages & input section reached', totalSteps: 4 });
  await sleep(1000);
  write({ type: 'tool_end', toolId: 't4', toolName: 'shell', extension: 'developer' });
  await sleep(2000);

  // ── 截圖 ──────────────────────────────────────────────────────
  write({ type: 'tool_start', toolId: 't5', toolName: 'shell', extension: 'developer' });
  await sleep(300);
  write({ type: 'tool_args', toolId: 't5', key: 'command', value: 'adb shell screencap -p /sdcard/screenshot.png' });
  await sleep(2000);
  write({ type: 'tool_end', toolId: 't5', toolName: 'shell', extension: 'developer' });
  await sleep(1500);

  // ── Session 結束 ───────────────────────────────────────────────
  write({ type: 'session_end', reason: 'completed' });

  console.log('\n模擬完成！Tester 角色應該已經回到 idle 狀態。');
}

main().catch(console.error);
