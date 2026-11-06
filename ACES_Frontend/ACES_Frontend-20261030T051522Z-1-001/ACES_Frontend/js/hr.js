// HR 查詢看板：即時人數、依小隊 / 部門 / 工號 / 姓名查詢、補登記、修改人數（最高修改權）。

const HR_OPERATOR = "HR"; // 看板不做登入：補登記寫入報到負責人、完成報到寫入簽收人都記為 HR
const TEAM_OPTIONS = Array.from({ length: 8 }, (_, i) => `第${i + 1}隊`); // 補登記的小隊下拉選項
const ALL = "";

let records = [];
const filters = { team: ALL, unit: ALL, empId: "", name: "" };

const teamFilter = $("teamFilter");
const unitFilter = $("unitFilter");

function sum(list, pick) {
  return list.reduce((total, item) => total + pick(item), 0);
}

function renderStats(claimedTotal) {
  // 應報到：名單內的人；實際報到：全部已報到者（含補登記）。
  const listed = records.filter((r) => !r.walk_in);
  const checked = records.filter((r) => r.checked_in);
  const missing = listed.filter((r) => !r.checked_in);
  const claimed = checked.filter((r) => r.claimed);
  const walkIns = checked.filter((r) => r.walk_in).length;

  $("statExpected").textContent = listed.length;
  $("statExpectedSub").textContent = `含眷屬 ${listed.length + sum(listed, (r) => r.declared_relatives)} 人`;
  $("statActual").textContent = checked.length;
  $("statActualSub").textContent = `含眷屬 ${checked.length + sum(checked, (r) => r.relatives)} 人${walkIns ? `（補登記 ${walkIns}）` : ""}`;
  $("statMissing").textContent = missing.length;
  $("statMissingSub").textContent = `含眷屬 ${missing.length + sum(missing, (r) => r.declared_relatives)} 人`;
  $("statClaimed").textContent = claimed.length;
  $("statClaimedSub").textContent = `金額 ${formatMoney(claimedTotal)}`;
}

// 篩選選單選項由資料動態產生，並保留目前選擇。
function fillSelect(select, label, values, current) {
  const options = [el("option", { value: ALL, text: `${label}：全部` })];
  [...new Set(values)].sort().forEach((v) => options.push(el("option", { value: v, text: v })));
  select.replaceChildren(...options);
  select.value = values.includes(current) ? current : ALL;
  return select.value;
}

function renderFilters() {
  filters.team = fillSelect(teamFilter, "小隊", TEAM_OPTIONS, filters.team);
  filters.unit = fillSelect(unitFilter, "部門", records.map((r) => r.unit), filters.unit);
}

function matches(row) {
  if (filters.team && row.team !== filters.team) return false;
  if (filters.unit && row.unit !== filters.unit) return false;
  if (filters.empId && !row.emp_id.toLowerCase().includes(filters.empId.toLowerCase())) return false;
  if (filters.name && !row.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
  return true;
}

function checkinCell(row) {
  if (!row.checked_in) return el("span", { class: "badge no", text: "未報到" });
  return el(
    "div",
    {},
    el("span", { class: "badge ok", text: "已報到" }),
    el("small", { text: `${row.checked_in_at}（${row.operator_id}）` })
  );
}

function claimCell(row) {
  if (row.claimed) {
    return el("div", {}, el("span", { class: "badge ok", text: "已領取" }), el("small", { text: `${row.signed_at}（${row.signer_id}）` }));
  }
  // 補登記的人沒有信件，點「待領取」直接顯示他的領取頁。
  if (row.checked_in && row.walk_in) {
    return el("button", { type: "button", class: "badge wait badge-btn", title: "查看領取頁", text: "待領取", onclick: () => showClaimPage(row) });
  }
  if (row.checked_in) return el("span", { class: "badge wait", text: "待領取" });
  return el("span", { class: "badge tag", text: "—" });
}

function renderTable() {
  const rows = records.filter(matches);
  const body = $("tableBody");

  if (!rows.length) {
    body.replaceChildren(el("tr", { class: "empty-row" }, el("td", { colspan: "10", text: "查無符合資料" })));
    return;
  }

  body.replaceChildren(
    ...rows.map((row) => {
      // 報到完成即產生領取 QR Code，之後只能檢視人數，不可再改。
      const editBtn = el("button", {
        type: "button",
        class: "secondary-btn small-btn",
        text: "報到人數",
        disabled: !row.checked_in,
        title: row.checked_in ? "" : "尚未報到",
        onclick: () => openEdit(row),
      });
      const walkInBadge = row.walk_in ? el("span", { class: "badge tag", text: "補登記" }) : null;

      return el(
        "tr",
        {},
        el("td", { text: row.emp_id }),
        el("td", {}, row.name, " ", walkInBadge),
        el("td", { text: row.unit }),
        el("td", { text: row.team }),
        el("td", { text: row.declared_relatives }),
        el("td", { text: row.relatives == null ? "-" : row.relatives }),
        el("td", { text: row.amount == null ? "-" : formatMoney(row.amount) }),
        el("td", {}, checkinCell(row)),
        el("td", {}, claimCell(row)),
        el("td", {}, editBtn)
      );
    })
  );
}

async function refresh() {
  let claimedTotal;
  [records, claimedTotal] = await Promise.all([api.listRecords(), api.getClaimedTotal()]);
  renderFilters();
  renderStats(claimedTotal);
  renderTable();
  $("updatedAt").textContent = new Date().toLocaleTimeString("zh-TW", { hour12: false });
}

// ---------- 修改人數 ----------

function openEdit(row) {
  // 已產生領取碼，人數僅供檢視：＋／－ 停用、沒有取消／確認鍵，點視窗外或按 Esc 關閉。
  const stepper = createStepper({ value: row.relatives, min: 0, max: CONFIG.MAX_RELATIVES });
  stepper.node.querySelectorAll("button").forEach((b) => (b.disabled = true));

  const body = el(
    "div",
    {},
    el("p", { class: "modal-text", text: `${row.name}（${row.emp_id}）　表單填寫眷屬 ${row.declared_relatives} 人` }),
    el("label", { class: "field-label", text: "報到眷屬人數" }),
    stepper.node,
    el("p", { class: "modal-text", style: "margin-top:16px" }, "金額：", el("strong", { class: "amount-strong", text: formatMoney(row.amount) }))
  );

  openModal({ title: "報到人數", body, actions: [] });
}

// ---------- 補登記 ----------

function openWalkIn() {
  const empId = el("input", { class: "input compact", placeholder: "工號，例如 T12345", autocomplete: "off", autocapitalize: "characters" });
  const name = el("input", { class: "input compact", placeholder: "姓名", autocomplete: "off" });
  // 部門：可直接輸入，也可從現有部門下拉選取。
  const unit = el("input", { class: "input compact", placeholder: "部門（可下拉選擇）", autocomplete: "off", list: "unitOptions" });
  const unitOptions = el(
    "datalist",
    { id: "unitOptions" },
    [...new Set(records.map((r) => r.unit))].sort().map((v) => el("option", { value: v }))
  );
  const team = el(
    "select",
    { class: "input compact" },
    el("option", { value: "", text: "小隊（選填）" }),
    TEAM_OPTIONS.map((v) => el("option", { value: v, text: v }))
  );
  const error = el("p", { class: "error-text" });
  const stepper = createStepper({ value: 0, min: 0, max: CONFIG.MAX_RELATIVES });

  const body = el(
    "div",
    { class: "form-grid" },
    el("div", {}, el("label", { class: "field-label", text: "工號" }), empId),
    el("div", { class: "form-grid two" }, el("div", {}, el("label", { class: "field-label", text: "姓名" }), name), el("div", {}, el("label", { class: "field-label", text: "部門" }), unit, unitOptions)),
    el("div", {}, el("label", { class: "field-label", text: "小隊" }), team),
    el("div", {}, el("label", { class: "field-label", text: "眷屬人數" }), stepper.node),
    error
  );

  openModal({
    title: "補登記報到",
    body,
    actions: [
      { label: "取消" },
      {
        label: "登記並報到",
        primary: true,
        onClick: async () => {
          if (!isValidEmpId(empId.value)) {
            error.textContent = "工號格式錯誤：T 或 111 開頭加 5 碼數字";
            return false;
          }
          if (!name.value.trim() || !unit.value.trim()) {
            error.textContent = "請填寫姓名與部門";
            return false;
          }
          try {
            const row = await api.registerWalkIn({
              empId: empId.value,
              name: name.value,
              unit: unit.value,
              team: team.value,
              relatives: stepper.value,
              operatorId: HR_OPERATOR,
            });
            toast(`補登記成功：${row.name}（眷屬 ${row.relatives} 人）`);
            await refresh();
            showClaimPage(row, `已完成補登記：${row.name}`);
          } catch (err) {
            error.textContent = errorText(err);
            return false;
          }
        },
      },
    ],
  });
  empId.focus();
}

// 補登記的人沒有信件，直接在視窗內顯示他的領取頁（領取碼）給對方出示。
function showClaimPage(row, title = `領取補助款：${row.name}`) {
  const src = new URL(`claim.html?c=${row.seed_code}`, location.href).href;
  openModal({
    title,
    body: el("iframe", { class: "claim-frame", src, title: "領取補助款" }),
    actions: [
      { label: "察看確認" },
      {
        label: "完成報到",
        primary: true,
        onClick: async () => {
          try {
            await api.signReceipt({ claimCode: row.claim_code, signerId: HR_OPERATOR });
            toast(`領取完成：${row.name}`);
          } catch (err) {
            toast(errorText(err), "error");
          }
          await refresh();
        },
      },
    ],
  });
}

// ---------- 事件 ----------

teamFilter.addEventListener("change", () => {
  filters.team = teamFilter.value;
  renderTable();
});
unitFilter.addEventListener("change", () => {
  filters.unit = unitFilter.value;
  renderTable();
});
$("idFilter").addEventListener("input", (e) => {
  filters.empId = e.target.value.trim();
  renderTable();
});
$("nameFilter").addEventListener("input", (e) => {
  filters.name = e.target.value.trim();
  renderTable();
});
$("clearFilterBtn").addEventListener("click", () => {
  filters.team = filters.unit = ALL;
  filters.empId = filters.name = "";
  $("idFilter").value = "";
  $("nameFilter").value = "";
  renderFilters();
  renderTable();
});

$("walkinBtn").addEventListener("click", openWalkIn);
if (!CONFIG.ALLOW_WALKIN_REGISTER) $("walkinBtn").hidden = true;

setInterval(refresh, CONFIG.POLL_MS);
window.addEventListener("storage", refresh);
refresh();
