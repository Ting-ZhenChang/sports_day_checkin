// 各頁共用的小工具：建立 DOM、提示訊息、確認視窗、QR 顯示、錯誤文字。

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  children.flat().forEach((child) => {
    if (child != null && child !== false) node.append(child);
  });
  return node;
}

function $(id) {
  return document.getElementById(id);
}

function formatMoney(n) {
  return `NT$ ${Number(n).toLocaleString("en-US")}`;
}

// 每次寫入資料庫後都要跳提示，讓操作者知道已完成。
function toast(message, type = "ok") {
  let box = $("toastBox");
  if (!box) {
    box = el("div", { id: "toastBox", class: "toast-box" });
    document.body.append(box);
  }
  const node = el("div", { class: `toast ${type}`, role: "status" }, message);
  box.append(node);
  setTimeout(() => node.remove(), 3400);
}

// body 為 Node；actions 的 onClick 回傳 false 代表保持視窗開啟（例如欄位驗證失敗）。
function openModal({ title, body, actions }) {
  const overlay = el("div", { class: "modal-overlay" });
  const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true" });
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();

  // 沒有按鍵的視窗（純檢視）：點視窗外或按 Esc 關閉。
  if (!actions.length) {
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    document.addEventListener("keydown", onKey);
  }

  const row = el("div", { class: "modal-actions" });
  actions.forEach((action) => {
    const button = el("button", {
      type: "button",
      class: action.primary ? "primary-btn" : "secondary-btn",
      text: action.label,
    });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const keepOpen = action.onClick ? await action.onClick() === false : false;
        if (keepOpen) button.disabled = false;
        else close();
      } catch (err) {
        button.disabled = false;
        throw err;
      }
    });
    row.append(button);
  });

  box.append(el("h3", { text: title }), body || "");
  if (actions.length) box.append(row);
  overlay.append(box);
  document.body.append(overlay);
  return { close };
}

function confirmDialog({ title, body, confirmText, cancelText }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: typeof body === "string" ? el("p", { class: "modal-text", text: body }) : body,
      actions: [
        { label: cancelText, onClick: () => resolve(false) },
        { label: confirmText, primary: true, onClick: () => resolve(true) },
      ],
    });
  });
}

function renderQr(container, text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

// 錯誤代碼 → 文字。員工頁用雙語（zh + en），工作人員頁只用中文。
const ERROR_TEXT = {
  NOT_FOUND: { zh: "查無此人或代碼無效", en: "Record not found" },
  INVALID_OPERATOR: { zh: "工號格式錯誤", en: "Invalid employee ID" },
  INVALID_EMP_ID: { zh: "工號格式錯誤（T 或 111 開頭加 5 碼數字）", en: "Invalid employee ID" },
  INVALID_RELATIVES: { zh: "眷屬人數超出範圍", en: "Headcount out of range" },
  MISSING_FIELDS: { zh: "請填寫姓名與部門", en: "Name and department are required" },
  ALREADY_CHECKED_IN: { zh: "已報到，不可重複報到", en: "Already checked in" },
  NOT_CHECKED_IN: { zh: "尚未報到", en: "Not checked in yet" },
  ALREADY_CLAIMED: { zh: "已領取", en: "Already received" },
  CLAIM_CODE_ISSUED: { zh: "已產生領取碼，不可修改人數", en: "Claim code already issued" },
};

function errorText(err, bilingual = false) {
  const entry = ERROR_TEXT[err && err.code];
  if (!entry) return bilingual ? "發生錯誤，請稍後再試 / Something went wrong" : "發生錯誤，請稍後再試";
  return bilingual ? `${entry.zh} / ${entry.en}` : entry.zh;
}

// 工作人員自己的工號：只記錄是誰操作，不做驗證。
function getOperator(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function setOperator(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // 無痕模式等無法儲存時，只是每次重開要重新輸入
  }
}

// 「＋ / －」人數選擇器（不可手打，避免輸入錯誤）。
function createStepper({ value, min, max, onChange }) {
  let current = value;
  const output = el("output", { class: "stepper-value", text: String(current) });
  const minus = el("button", { type: "button", class: "secondary-btn stepper-btn", "aria-label": "減少 / decrease", text: "−" });
  const plus = el("button", { type: "button", class: "secondary-btn stepper-btn", "aria-label": "增加 / increase", text: "＋" });

  function sync() {
    output.textContent = String(current);
    minus.disabled = current <= min;
    plus.disabled = current >= max;
    if (onChange) onChange(current);
  }
  minus.addEventListener("click", () => {
    if (current > min) current -= 1;
    sync();
  });
  plus.addEventListener("click", () => {
    if (current < max) current += 1;
    sync();
  });
  sync();

  return { node: el("div", { class: "stepper" }, minus, output, plus), get value() { return current; } };
}

// 工號輸入畫面共用邏輯：回傳正規化後的工號，格式不符回傳 null 並顯示錯誤。
function readEmpIdInput(input, errorNode) {
  const value = normalizeEmpId(input.value);
  if (!isValidEmpId(value)) {
    errorNode.textContent = "工號格式錯誤：T 或 111 開頭加 5 碼數字（例如 T12345）";
    return null;
  }
  errorNode.textContent = "";
  return value;
}
