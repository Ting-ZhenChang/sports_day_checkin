// 員工領取頁：信件連結（?c=<種子碼>）進入，中英雙語。
// 流程：未報到擋下 → 報到完成後直接顯示資料與唯一領取碼（不需任何確認）
//       → HR / 財務掃碼並按下確認 → 顯示「領取成功」，之後再進入顯示「已領取」。

const claimViews = {
  loading: $("loadingView"),
  invalid: $("invalidView"),
  blocked: $("blockedView"),
  code: $("codeView"),
  done: $("doneView"),
};

const seed = new URLSearchParams(location.search).get("c");
let currentRow = null;
let pollTimer = null;
let drawnCode = null;

function showClaimView(name) {
  Object.entries(claimViews).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
  clearInterval(pollTimer);
  // 等待 HR 掃碼期間，定時更新（HR 若修改人數或已簽收會即時反映）。
  if (name === "code") pollTimer = setInterval(refresh, CONFIG.POLL_MS);
}

function peopleText(row) {
  return `員工 1 人 + 眷屬 ${row.relatives} 人<span class="en block">1 employee + ${row.relatives} guest${row.relatives === 1 ? "" : "s"}</span>`;
}

function renderCode(row) {
  // 領取碼不變時不重畫 QR，避免定時更新造成畫面閃爍。
  if (drawnCode !== row.claim_code) {
    renderQr($("claimQr"), row.claim_code);
    drawnCode = row.claim_code;
  }
  $("claimCodeText").textContent = row.claim_code;
  $("cEmpId").textContent = row.emp_id;
  $("cName").textContent = row.name;
  $("cTime").textContent = row.checked_in_at;
  $("cPeople").innerHTML = peopleText(row);
  $("cAmount").textContent = formatMoney(row.amount);
  showClaimView("code");
}

function renderDone(row, justNow) {
  $("doneTitle").innerHTML = justNow
    ? "領取成功 <span class=\"en block\">Received successfully</span>"
    : "已領取 <span class=\"en block\">Already received</span>";
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

  const wasWaiting = currentRow && currentRow.checked_in && !currentRow.claimed && !claimViews.code.hidden;
  currentRow = row;

  if (!row.checked_in) showClaimView("blocked");
  else if (row.claimed) {
    // 已經顯示完成畫面就不重畫，避免「領取成功」被之後的更新改成「已領取」。
    if (claimViews.done.hidden) renderDone(row, wasWaiting);
  } else renderCode(row);
}

$("refreshBtn").addEventListener("click", refresh);

// 另一個分頁（報到 / HR 簽收）寫入資料時，立刻更新畫面。
window.addEventListener("storage", refresh);

if (!seed) showClaimView("invalid");
else refresh();
