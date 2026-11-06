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

// 顯示代碼文字（電腦沒有相機時，可複製後貼到報到頁 / 簽收頁的「手動輸入代碼」），並提供 QR 與複製按鈕。
function codeCell(code, qrTitle) {
  return el(
    "div",
    { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" },
    el("span", { class: "mono", style: "font-weight:800;font-size:13px", text: code }),
    el("button", {
      type: "button",
      class: "ghost-btn small-btn",
      text: "複製",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(code);
          toast("已複製代碼");
        } catch {
          toast("無法自動複製，請手動選取代碼", "error");
        }
      },
    }),
    el("button", { type: "button", class: "secondary-btn small-btn", text: "QR", onclick: () => showQrModal(qrTitle, code) })
  );
}

function statusBadge(row) {
  if (row.claimed) return el("span", { class: "badge ok", text: "已領取" });
  if (row.checked_in) return el("span", { class: "badge wait", text: "已報到，待領取" });
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
        el("td", {}, codeCell(row.seed_code, `${row.name} 的報到 QR`)),
        el("td", {}, el("a", { class: "link-btn", href: `claim.html?c=${row.seed_code}`, target: "_blank", rel: "noopener", text: "開啟" })),
        el("td", {}, row.claim_code && !row.claimed ? codeCell(row.claim_code, `${row.name} 的領取碼`) : el("span", { class: "badge tag", text: "—" }))
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
