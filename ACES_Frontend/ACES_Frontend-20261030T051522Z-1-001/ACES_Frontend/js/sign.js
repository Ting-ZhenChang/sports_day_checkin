// HR 簽收掃碼頁：掃員工的領取碼 → 寫入簽收人、時間，是否領取 0 → 1。掃完才算交易完成。

const SIGNER_KEY = "aces_operator_sign";

const signViews = {
  login: $("loginView"),
  scan: $("scanView"),
  result: $("resultView"),
};

let signerId = getOperator(SIGNER_KEY);
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

function personRows(row) {
  return [
    infoRow("姓名", row.name),
    infoRow("工號", row.emp_id),
    infoRow("人數", `員工 1 人 + 眷屬 ${row.relatives} 人`),
    infoRow("金額", formatMoney(row.amount), true),
  ];
}

async function handleClaimCode(text) {
  if (busy) return;
  busy = true;
  try {
    const row = await api.signReceipt({ claimCode: text, signerId });
    toast(`簽收成功：${row.name}　${formatMoney(row.amount)}`);
    showResult({
      icon: "✓",
      kind: "",
      title: "簽收成功，請交付現金",
      rows: [...personRows(row), infoRow("簽收時間", row.signed_at)],
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
      toast(err.code === "NOT_FOUND" ? "領取碼無效" : errorText(err), "error");
      showResult({
        icon: "×",
        kind: "stop",
        title: err.code === "NOT_FOUND" ? "領取碼無效" : errorText(err),
        rows: [],
      });
    }
  } finally {
    busy = false;
  }
}

function enterScan() {
  $("signerLabel").textContent = signerId;
  $("scanError").hidden = true;
  showSignView("scan");
  scanner.start();
  scanner.resume();
}

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

$("changeSignerBtn").addEventListener("click", () => {
  scanner.stop();
  setOperator(SIGNER_KEY, "");
  signerId = "";
  $("signerInput").value = "";
  showSignView("login");
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
