// 報到頁（報到工作人員）：輸入自己的工號 → 掃員工 QR code → ＋／－ 調整眷屬人數 → 確認報到。

const OPERATOR_KEY = "aces_operator_checkin";

const checkinViews = {
  login: $("loginView"),
  scan: $("scanView"),
  result: $("resultView"),
  notice: $("noticeView"),
};

let operatorId = getOperator(OPERATOR_KEY);
let currentSeed = null;
let currentStepper = null;
let busy = false;

const scanner = createScanner({
  video: $("video"),
  onDecode: (text) => handleCode(text),
  onError: (message) => {
    $("scanError").textContent = message;
    $("scanError").hidden = false;
    $("manualForm").hidden = false;
  },
});

function showCheckinView(name) {
  Object.entries(checkinViews).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
}

function backToScan() {
  currentSeed = null;
  currentStepper = null;
  showCheckinView("scan");
  scanner.start();
  scanner.resume();
}

function showNotice({ icon, kind, title, text }) {
  $("noticeIcon").textContent = icon;
  $("noticeIcon").className = `status-icon ${kind}`;
  $("noticeTitle").textContent = title;
  $("noticeText").textContent = text;
  showCheckinView("notice");
}

function renderResult(row) {
  currentSeed = row.seed_code;
  $("rName").textContent = row.name;
  $("rEmpId").textContent = row.emp_id;
  $("rUnit").textContent = row.unit;
  $("rTeam").textContent = row.team;
  $("rDeclared").textContent = row.declared_relatives;

  // 預設帶入表單填寫數，可調整 0 ~ 填寫數（＋／－ 按鈕，不可手打）。
  const max = maxRelativesFor(row.declared_relatives);
  currentStepper = createStepper({
    value: Math.min(row.declared_relatives, max),
    min: 0,
    max,
    onChange: (n) => {
      $("rTotal").textContent = `${1 + n} 人`;
    },
  });
  $("stepperSlot").replaceChildren(currentStepper.node);
  showCheckinView("result");
}

// 掃到（或手動輸入）一組種子碼。
async function handleCode(text) {
  if (busy) return;
  busy = true;
  try {
    const row = await api.lookupBySeed(text);
    if (row.checked_in) {
      showNotice({
        icon: "!",
        kind: "warn",
        title: `${row.name} 已報到`,
        text: `報到時間：${row.checked_in_at}。已報到者不能重複報到。`,
      });
    } else {
      renderResult(row);
    }
  } catch {
    showNotice({
      icon: "×",
      kind: "stop",
      title: "查無此人",
      text: "此 QR code 不在名單內。沒填表單的人或晚到者，請洽 HR 在查詢看板補登記。",
    });
  } finally {
    busy = false;
  }
}

$("startBtn").addEventListener("click", () => {
  const value = readEmpIdInput($("operatorInput"), $("operatorError"));
  if (!value) return;
  operatorId = value;
  setOperator(OPERATOR_KEY, value);
  enterScan();
});

$("operatorInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("startBtn").click();
});

function enterScan() {
  $("operatorLabel").textContent = operatorId;
  $("scanError").hidden = true;
  showCheckinView("scan");
  scanner.start();
}

$("manualToggle").addEventListener("click", () => {
  $("manualForm").hidden = !$("manualForm").hidden;
  if (!$("manualForm").hidden) $("manualInput").focus();
});

$("manualForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = $("manualInput").value.trim();
  if (!value) return;
  $("manualInput").value = "";
  handleCode(value);
});

$("confirmBtn").addEventListener("click", async () => {
  if (!currentSeed || !currentStepper) return;
  $("confirmBtn").disabled = true;
  try {
    const row = await api.checkIn({ seed: currentSeed, operatorId, relatives: currentStepper.value });
    toast(`報到成功：${row.name}（員工 1 人＋眷屬 ${row.relatives} 人）`);
    backToScan();
  } catch (err) {
    toast(errorText(err), "error");
    if (err.code === "ALREADY_CHECKED_IN") backToScan();
  } finally {
    $("confirmBtn").disabled = false;
  }
});

$("cancelBtn").addEventListener("click", backToScan);
$("noticeBtn").addEventListener("click", backToScan);

if (operatorId && isValidEmpId(operatorId)) enterScan();
else showCheckinView("login");
