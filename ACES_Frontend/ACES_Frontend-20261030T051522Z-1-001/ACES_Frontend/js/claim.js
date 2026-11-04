// 員工領取頁：信件連結（?c=<種子碼>）進入，中英雙語。
// 流程：未報到擋下 → 確認資料並勾選 → 再次確認 → 產生領取碼 → HR 掃碼後顯示「領取成功」。

const claimViews = {
  loading: $("loadingView"),
  invalid: $("invalidView"),
  blocked: $("blockedView"),
  form: $("formView"),
  code: $("codeView"),
  done: $("doneView"),
};

const seed = new URLSearchParams(location.search).get("c");
let currentRow = null;
let pollTimer = null;

function showClaimView(name) {
  Object.entries(claimViews).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
  clearInterval(pollTimer);
  // 等待 HR 掃碼期間，定時檢查是否已簽收。
  if (name === "code") pollTimer = setInterval(refresh, CONFIG.POLL_MS);
}

function peopleText(row) {
  return `員工 1 人 + 眷屬 ${row.relatives} 人 / 1 employee + ${row.relatives} guest${row.relatives === 1 ? "" : "s"}`;
}

function renderForm(row) {
  $("fEmpId").textContent = row.emp_id;
  $("fName").textContent = row.name;
  $("fTime").textContent = row.checked_in_at;
  $("fPeople").textContent = peopleText(row);
  $("fAmount").textContent = formatMoney(row.amount);
  $("confirmCheck").checked = false;
  $("generateBtn").disabled = true;
  showClaimView("form");
}

function renderCode(row) {
  renderQr($("claimQr"), row.claim_code);
  $("claimCodeText").textContent = row.claim_code;
  $("cName").textContent = row.name;
  $("cAmount").textContent = formatMoney(row.amount);
  showClaimView("code");
}

function renderDone(row, justNow) {
  $("doneTitle").innerHTML = justNow ? "領取成功 <span class=\"en block\">Received successfully</span>" : "已領取 <span class=\"en block\">Already received</span>";
  $("doneTime").textContent = `${row.signed_at}`;
  showClaimView("done");
}

// 依目前資料決定顯示哪一個畫面（也用於定時更新）。
async function refresh() {
  let row;
  try {
    row = await api.lookupBySeed(seed);
  } catch {
    showClaimView("invalid");
    return;
  }

  const wasWaiting = currentRow && currentRow.claim_code && !currentRow.claimed;
  currentRow = row;

  if (!row.checked_in) showClaimView("blocked");
  else if (row.claimed) renderDone(row, wasWaiting);
  else if (row.claim_code) {
    // 已產生領取碼、尚未簽收：只在畫面不是領取碼時才重畫，避免每次輪詢閃爍。
    if (claimViews.code.hidden) renderCode(row);
  } else renderForm(row);
}

$("confirmCheck").addEventListener("change", (e) => {
  $("generateBtn").disabled = !e.target.checked;
});

$("refreshBtn").addEventListener("click", refresh);

$("generateBtn").addEventListener("click", async () => {
  if (!currentRow) return;

  const confirmed = await confirmDialog({
    title: "請確認金額與人數是否正確 / Please confirm the amount and headcount",
    body: el(
      "div",
      { class: "big-people" },
      el("div", { class: "row total" }, el("span", { text: "金額 Amount" }), el("span", { text: formatMoney(currentRow.amount) })),
      el("div", { class: "row" }, el("span", { text: "眷屬 Guests" }), el("span", { text: `${currentRow.relatives}` }))
    ),
    confirmText: "確認 Confirm",
    cancelText: "返回 Back",
  });
  if (!confirmed) return;

  try {
    const row = await api.confirmClaim(seed);
    currentRow = row;
    toast("領取碼已產生 / Claim code generated");
    renderCode(row);
  } catch (err) {
    toast(errorText(err, true), "error");
    refresh();
  }
});

// 另一個分頁（HR 簽收）寫入資料時，立刻更新畫面。
window.addEventListener("storage", refresh);

if (!seed) showClaimView("invalid");
else refresh();
