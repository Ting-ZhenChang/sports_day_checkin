// 開發用導覽頁：列出示範員工的 QR / 連結，方便測試四個頁面。

function showQrModal(title, code) {
  const box = el("div", { class: "qr-canvas" });
  openModal({
    title,
    body: el("div", { class: "center" }, el("div", { class: "qr-box" }, box), el("p", { class: "mono", style: "font-weight:800", text: code })),
    actions: [{ label: "關閉", primary: true }],
  });
  renderQr(box, code);
}

function statusBadge(row) {
  if (row.claimed) return el("span", { class: "badge ok", text: "已領取" });
  if (row.claim_code) return el("span", { class: "badge wait", text: "待簽收" });
  if (row.checked_in) return el("span", { class: "badge ok", text: "已報到" });
  return el("span", { class: "badge no", text: "未報到" });
}

async function renderDemo() {
  const rows = await api.listRecords();
  $("demoBody").replaceChildren(
    ...rows.map((row) =>
      el(
        "tr",
        {},
        el("td", { text: row.emp_id }),
        el("td", { text: row.name }),
        el("td", { text: row.declared_relatives }),
        el("td", {}, statusBadge(row)),
        el("td", {}, el("button", { type: "button", class: "secondary-btn small-btn", text: "顯示 QR", onclick: () => showQrModal(`${row.name} 的報到 QR`, row.seed_code) })),
        el("td", {}, el("a", { class: "link-btn", href: `claim.html?c=${row.seed_code}`, target: "_blank", rel: "noopener", text: "開啟" })),
        el(
          "td",
          {},
          row.claim_code && !row.claimed
            ? el("button", { type: "button", class: "secondary-btn small-btn", text: "顯示 QR", onclick: () => showQrModal(`${row.name} 的領取碼`, row.claim_code) })
            : el("span", { class: "badge tag", text: "—" })
        )
      )
    )
  );
}

$("resetBtn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "重設示範資料？",
    body: "所有報到與簽收紀錄會被清除，並恢復為原本的示範員工。",
    confirmText: "重設",
    cancelText: "取消",
  });
  if (!ok) return;
  await api.resetDemo();
  toast("已重設示範資料");
  renderDemo();
});

window.addEventListener("storage", renderDemo);
renderDemo();
