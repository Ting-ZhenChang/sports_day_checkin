// HR / 財務簽收頁：掃員工的領取碼 → 顯示此人已報到完成的資料 → 按下「確認領取完成」
// 才寫入簽收人、時間，是否領取 0 → 1。確認按鈕只在這一頁。

const SIGNER_KEY = "aces_operator_sign";

const signViews = {
  login: $("loginView"),
  scan: $("scanView"),
  confirm: $("confirmView"),
  result: $("resultView"),
};

let signerId = getOperator(SIGNER_KEY);
let currentClaimCode = null;
let busy = false;

const scanner = createScanner({
  video: $("video"),
  onDecode: (text) => handleClaimCode(text),
  onError: (message) => {
    $("scanError").textContent = message;
    $("scanError").hidden = false;
    $("manualForm").hidden = false;
  },
});

function showSignView(name) {
  Object.entries(signViews).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
}

function infoRow(label, value, strong = false) {
  return el("div", {}, el("dt", { text: label }), el("dd", { class: strong ? "amount-strong" : "", text: value }));
}

function showResult({ icon, kind, title, rows }) {
  $("resultIcon").textContent = icon;
  $("resultIcon").className = `status-icon ${kind}`;
  $("resultTitle").textContent = title;
  $("resultInfo").replaceChildren(...rows);
  showSignView("result");
}

// 此人的報到完成資料（與報到頁 / 員工頁一致）。
function personRows(row) {
  return [
    infoRow("姓名", row.name),
    infoRow("工號", row.emp_id),
    infoRow("部門 / 小隊", `${row.unit} / ${row.team}`),
    infoRow("報到時間", `${row.checked_in_at}（${row.operator_id}）`),
    infoRow("人數", `員工 1 人 + 眷屬 ${row.relatives} 人`),
    infoRow("金額", formatMoney(row.amount), true),
  ];
}

// 掃到（或手動輸入）領取碼：只查詢並顯示，不寫入。
async function handleClaimCode(text) {
  if (busy) return;
  busy = true;
  try {
    const row = await api.lookupByClaimCode(text);
    if (row.claimed) {
      showResult({
        icon: "!",
        kind: "warn",
        title: "已領取，請勿重複發放",
        rows: [...personRows(row), infoRow("簽收時間", row.signed_at), infoRow("簽收人", row.signer_id)],
      });
      return;
    }
    currentClaimCode = text;
    $("confirmInfo").replaceChildren(...personRows(row));
    showSignView("confirm");
  } catch (err) {
    showResult({ icon: "×", kind: "stop", title: err.code === "NOT_FOUND" ? "領取碼無效" : errorText(err), rows: [] });
  } finally {
    busy = false;
  }
}

// 按下「確認領取完成」：寫入簽收人與時間。
$("signBtn").addEventListener("click", async () => {
  if (!currentClaimCode) return;
  $("signBtn").disabled = true;
  try {
    const row = await api.signReceipt({ claimCode: currentClaimCode, signerId });
    toast(`領取完成：${row.name}　${formatMoney(row.amount)}`);
    showResult({
      icon: "✓",
      kind: "",
      title: "領取完成",
      rows: [...personRows(row), infoRow("簽收時間", row.signed_at), infoRow("簽收人", row.signer_id)],
    });
  } catch (err) {
    if (err.code === "ALREADY_CLAIMED" && err.row) {
      toast("此領取碼已簽收，請勿重複發放", "error");
      showResult({
        icon: "!",
        kind: "warn",
        title: "已領取，請勿重複發放",
        rows: [...personRows(err.row), infoRow("簽收時間", err.row.signed_at), infoRow("簽收人", err.row.signer_id)],
      });
    } else {
      toast(errorText(err), "error");
    }
  } finally {
    currentClaimCode = null;
    $("signBtn").disabled = false;
  }
});

function enterScan() {
  currentClaimCode = null;
  $("signerLabel").textContent = signerId;
  $("scanError").hidden = true;
  showSignView("scan");
  scanner.start();
  scanner.resume();
}

$("cancelSignBtn").addEventListener("click", enterScan);

$("startBtn").addEventListener("click", () => {
  const value = readEmpIdInput($("signerInput"), $("signerError"));
  if (!value) return;
  signerId = value;
  setOperator(SIGNER_KEY, value);
  enterScan();
});

$("signerInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("startBtn").click();
});

$("manualToggle").addEventListener("click", () => {
  $("manualForm").hidden = !$("manualForm").hidden;
  if (!$("manualForm").hidden) $("manualInput").focus();
});

$("manualForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = $("manualInput").value.trim();
  if (!value) return;
  $("manualInput").value = "";
  handleClaimCode(value);
});

$("nextBtn").addEventListener("click", enterScan);

if (signerId && isValidEmpId(signerId)) enterScan();
else showSignView("login");
