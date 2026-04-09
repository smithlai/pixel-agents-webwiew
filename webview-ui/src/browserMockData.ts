/**
 * 瀏覽器模式假資料工廠 — 模擬 MobileGoose 測試流程的時序事件。
 *
 * 從 browserBootstrap.ts 分離出來，僅包含 mock agent 的行為模擬。
 * bootstrap 透過 import 呼叫這些 schedule 函式來啟動模擬。
 */

// ── Mock test session simulation ─────────────────────────────────────────────

/** Helper: dispatch a sequence of timed events to simulate a MobileGoose test run. */
export function scheduleMockTestSession(dispatch: (data: unknown) => void): void {
  // Timeline helper — accumulates delay so steps are sequential
  let cursor = 0;
  function after(ms: number, fn: () => void): void {
    cursor += ms;
    setTimeout(fn, cursor);
  }

  // Swap tool status for a given agent (done old → start new)
  function swapTool(id: number, oldToolId: string, newToolId: string, status: string): void {
    dispatch({ type: 'agentToolDone', id, toolId: oldToolId });
    dispatch({ type: 'agentToolStart', id, toolId: newToolId, status });
  }

  const PM_ID = 101;
  const ANALYST_ID = 102;
  const TESTER_ID = 103;

  // Helper: make agent go idle (stand up, wander) while keeping overlay text
  function goIdle(id: number, toolId: string): void {
    dispatch({ type: 'agentToolDone', id, toolId });
    dispatch({ type: 'agentToolsClear', id });
    dispatch({ type: 'agentStatus', id, status: 'idle' });
  }

  // Helper: make agent active (walk back to seat, sit down, start tool)
  function goWork(id: number, toolId: string, status: string): void {
    dispatch({ type: 'agentStatus', id, status: 'active' });
    dispatch({ type: 'agentToolStart', id, toolId, status });
  }

  // ── PM reviews today's test plan ─────────────────────────────────────────────
  after(2000, () => {
    goWork(PM_ID, 'pm-plan', '審核今日測試計畫：STTL-181126 語言切換');
  });

  after(5000, () => {
    swapTool(PM_ID, 'pm-plan', 'pm-assign', '指派任務給 Tester：驗證多語言切換功能');
  });

  after(3000, () => {
    goIdle(PM_ID, 'pm-assign');
  });

  // ── Analyst starts background analysis ───────────────────────────────────────
  after(1000, () => {
    goWork(ANALYST_ID, 'analyst-read', '讀取歷史測試報告，分析失敗率趨勢');
  });

  after(6000, () => {
    swapTool(ANALYST_ID, 'analyst-read', 'analyst-stats', '統計近 7 日通過率：92.3% → 生成趨勢圖');
  });

  after(5000, () => {
    swapTool(ANALYST_ID, 'analyst-stats', 'analyst-report', '撰寫週報：語言切換模組穩定性分析');
  });

  // ── Tester receives task, reads test case ────────────────────────────────────
  after(1000, () => {
    goWork(TESTER_ID, 'tester-read', '收到任務，讀取測試案例 STTL-181126');
  });

  after(4000, () => {
    swapTool(TESTER_ID, 'tester-read', 'tester-parse', '解析前置條件：裝置需為英文環境');
  });

  after(3000, () => {
    swapTool(TESTER_ID, 'tester-parse', 'tester-plan', '規劃測試步驟：5 步驟自動化腳本');
  });

  // ── Tester dispatches DroidClaw (sub-agent spawn with matrix effect) ────────
  after(4000, () => {
    // Subtask: prefix triggers sub-agent spawn (matrix rain effect)
    swapTool(TESTER_ID, 'tester-plan', 'tester-dc', 'Subtask:DroidClaw 執行裝置操作');
  });

  // ── Mid-test: PM checks in ──────────────────────────────────────────────────
  after(2000, () => {
    goWork(PM_ID, 'pm-checkin', '確認 Tester 進度：DroidClaw 執行中');
  });

  after(4000, () => {
    swapTool(PM_ID, 'pm-checkin', 'pm-wait', '等待測試結果回報...');
  });

  // ── Analyst finishes report ─────────────────────────────────────────────────
  after(2000, () => {
    goIdle(ANALYST_ID, 'analyst-report');
  });

  // ── DroidClaw done (sub-agent despawn with matrix effect), Tester verifies ──
  after(15000, () => {
    dispatch({ type: 'agentToolDone', id: TESTER_ID, toolId: 'tester-dc' });
    dispatch({ type: 'agentToolsClear', id: TESTER_ID });
    goWork(TESTER_ID, 'tester-verify', '驗證結果：比對螢幕截圖與預期畫面');
  });

  after(4000, () => {
    swapTool(TESTER_ID, 'tester-verify', 'tester-screenshot', '擷取測試證據截圖');
  });

  // ── Tester reports to PM ────────────────────────────────────────────────────
  after(3000, () => {
    goIdle(TESTER_ID, 'tester-screenshot');
  });

  after(2000, () => {
    swapTool(PM_ID, 'pm-wait', 'pm-review', '審核測試報告：STTL-181126 語言切換');
  });

  after(4000, () => {
    swapTool(PM_ID, 'pm-review', 'pm-approve', '✓ 測試通過 — 簽核結案');
  });

  after(3000, () => {
    goIdle(PM_ID, 'pm-approve');
  });

  // ── Tester marks PASS ───────────────────────────────────────────────────────
  after(1000, () => {
    goWork(TESTER_ID, 'tester-result', '✓ PASS — STTL-181126 測試完成');
  });

  after(5000, () => {
    goIdle(TESTER_ID, 'tester-result');
  });

  // ── Analyst starts new task ─────────────────────────────────────────────────
  after(2000, () => {
    goWork(ANALYST_ID, 'analyst-new', '開始分析下一批測試數據');
  });

  after(8000, () => {
    goIdle(ANALYST_ID, 'analyst-new');
  });
}

/** Tester 3 agent mock — 分析室獨立測試循環 */
export function scheduleMockTester3Session(dispatch: (data: unknown) => void, id: number): void {
  let cursor = 0;
  function after(ms: number, fn: () => void): void {
    cursor += ms;
    setTimeout(fn, cursor);
  }
  function goIdle(toolId: string): void {
    dispatch({ type: 'agentToolDone', id, toolId });
    dispatch({ type: 'agentToolsClear', id });
    dispatch({ type: 'agentStatus', id, status: 'idle' });
  }
  function goWork(toolId: string, status: string): void {
    dispatch({ type: 'agentStatus', id, status: 'active' });
    dispatch({ type: 'agentToolStart', id, toolId, status });
  }
  function swapTool(oldId: string, newId: string, status: string): void {
    dispatch({ type: 'agentToolDone', id, toolId: oldId });
    dispatch({ type: 'agentToolStart', id, toolId: newId, status });
  }

  // Round 1: API 相容性驗證
  after(6000, () => goWork('t3-read1', '讀取測試案例 STTL-300001 API 相容性'));
  after(8000, () => swapTool('t3-read1', 't3-exec1', '執行 API 端點回歸測試：12 個端點'));
  after(7000, () => swapTool('t3-exec1', 't3-verify1', '驗證結果：v2 → v3 回應格式比對'));
  after(6000, () => goIdle('t3-verify1'));

  // Round 2: 效能壓力測試
  after(5000, () => goWork('t3-perf', '執行效能壓力測試：並發 100 連線'));
  after(9000, () => swapTool('t3-perf', 't3-perf-check', '驗證：P95 回應時間 < 200ms'));
  after(5000, () => swapTool('t3-perf-check', 't3-perf-result', '✓ PASS — 效能測試通過'));
  after(6000, () => goIdle('t3-perf-result'));

  // Round 3: 安全掃描測試
  after(8000, () => goWork('t3-scan', '執行安全掃描測試：第三方套件漏洞'));
  after(10000, () => swapTool('t3-scan', 't3-patch', '驗證修補方案：3 個高風險項目'));
  after(6000, () => goIdle('t3-patch'));
}

/** Tester 2 agent mock — Lab 2 獨立測試循環，包含 DroidClaw 2 */
export function scheduleMockTester2Session(dispatch: (data: unknown) => void, id: number): void {
  let cursor = 0;
  function after(ms: number, fn: () => void): void {
    cursor += ms;
    setTimeout(fn, cursor);
  }
  function goIdle(toolId: string): void {
    dispatch({ type: 'agentToolDone', id, toolId });
    dispatch({ type: 'agentToolsClear', id });
    dispatch({ type: 'agentStatus', id, status: 'idle' });
  }
  function goWork(toolId: string, status: string): void {
    dispatch({ type: 'agentStatus', id, status: 'active' });
    dispatch({ type: 'agentToolStart', id, toolId, status });
  }
  function swapTool(oldId: string, newId: string, status: string): void {
    dispatch({ type: 'agentToolDone', id, toolId: oldId });
    dispatch({ type: 'agentToolStart', id, toolId: newId, status });
  }

  // Round 1: 藍牙配對測試 STTL-200015
  after(8000, () => goWork('t2-read', '收到任務，讀取測試案例 STTL-200015 藍牙配對'));
  after(5000, () => swapTool('t2-read', 't2-plan', '規劃測試步驟：開啟藍牙 → 搜尋 → 配對 → 傳檔'));
  // Subtask: prefix triggers sub-agent spawn (matrix rain effect)
  after(4000, () => swapTool('t2-plan', 't2-dc', 'Subtask:DroidClaw 2 執行藍牙裝置操作'));

  // DroidClaw 2 sub-agent works for ~20s then done (despawn with matrix effect)
  after(20000, () => {
    dispatch({ type: 'agentToolDone', id, toolId: 't2-dc' });
    dispatch({ type: 'agentToolsClear', id });
    goWork('t2-verify', '驗證結果：檔案完整性比對');
  });
  after(5000, () => swapTool('t2-verify', 't2-result', '✓ PASS — STTL-200015 藍牙配對測試完成'));
  after(4000, () => goIdle('t2-result'));

  // Round 2: Wi-Fi 連線測試
  after(6000, () => goWork('t2-wifi-read', '收到任務，讀取測試案例 STTL-200022 Wi-Fi 切換'));
  after(5000, () => swapTool('t2-wifi-read', 't2-wifi-exec', '執行 Wi-Fi 斷線重連壓力測試'));
  after(8000, () => swapTool('t2-wifi-exec', 't2-wifi-verify', '驗證：連線恢復時間 < 3 秒'));
  after(4000, () => swapTool('t2-wifi-verify', 't2-wifi-result', '✓ PASS — STTL-200022 Wi-Fi 切換完成'));
  after(4000, () => goIdle('t2-wifi-result'));
}
