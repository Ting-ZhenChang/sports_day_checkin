// 活動規則設定。標示「待 HR 確認」的項目請在會後依 HR 決定調整。
const CONFIG = {
  // 補助金額由後端計算（見 mock-api.js），前端只顯示後端回傳的 amount。
  MAX_RELATIVES: 5, // 眷屬上限 5 人（待 HR 確認）

  // 報到眷屬人數可否超過表單填寫數（待 HR 確認；Tim 認為理論上不行）
  ALLOW_EXCEED_DECLARED: false,

  // HR 看板是否開放「補登記」（沒填表單 / 晚到者；功能要做，是否開放由 HR 決定）
  ALLOW_WALKIN_REGISTER: true,

  // 工號格式：T 或 111 開頭 + 5 碼數字。
  // 會議紀錄內文寫 T 與 111，決議事項寫 T 與 EE，兩者不一致，所以先全部接受（待確認）。
  EMP_ID_PATTERN: /^(T|111|EE)\d{5}$/,

  // 領款狀態自動更新間隔（毫秒）
  POLL_MS: 5000,
};

function normalizeEmpId(raw) {
  return String(raw || "").trim().toUpperCase();
}

function isValidEmpId(raw) {
  return CONFIG.EMP_ID_PATTERN.test(normalizeEmpId(raw));
}

// 以後 5 碼數字判斷是否為同一人（T12345 與 11112345 視為同一人）。
function empKey(empId) {
  return normalizeEmpId(empId).slice(-5);
}

// 報到時眷屬人數上限：預設為表單填寫數。
function maxRelativesFor(declared) {
  return CONFIG.ALLOW_EXCEED_DECLARED ? CONFIG.MAX_RELATIVES : Math.min(declared, CONFIG.MAX_RELATIVES);
}
