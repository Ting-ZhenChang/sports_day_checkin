// HR 查詢看板：即時人數、依小隊 / 部門 / 工號 / 姓名查詢、補登記、修改人數（最高修改權）。

const WALKIN_OPERATOR = "HR"; // 補登記時寫入報到表的負責人（看板不做登入）
const ALL = "";

let records = [];
const filters = { team: ALL, unit: ALL, empId: "", name: "" };

const teamFilter = $("teamFilter");
const unitFilter = $("unitFilter");

function sum(list, pick) {
  return list.reduce((total, item) => total + pick(item), 0);
}

function renderStats() {
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
  $("statClaimedSub").textContent = `金額 ${formatMoney(sum(claimed, (r) => r.amount))}`;
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
  filters.team = fillSelect(teamFilter, "小隊", records.map((r) => r.team), filters.team);
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
  if (row.claim_code) return el("span", { class: "badge wait", text: "已產生領取碼" });
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
      const editable = row.checked_in && !row.claimed;
      const editBtn = el("button", {
        type: "button",
        class: "secondary-btn small-btn",
        text: "修改人數",
        disabled: !editable,
        title: row.claimed ? "已領取，不可修改" : row.checked_in ? "" : "尚未報到",
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
  records = await api.listRecords();
  renderFilters();
  renderStats();
  renderTable();
  $("updatedAt").textContent = new Date().toLocaleTimeString("zh-TW", { hour12: false });
}

// ---------- 修改人數 ----------

function openEdit(row) {
  const amountText = el("strong", { class: "amount-strong", text: formatMoney(row.amount) });
  const stepper = createStepper({
    value: row.relatives,
    min: 0,
    max: CONFIG.MAX_RELATIVES,
    onChange: (n) => {
      amountText.textContent = formatMoney(calcAmount(n));
    },
  });

  const body = el(
    "div",
    {},
    el("p", { class: "modal-text", text: `${row.name}（${row.emp_id}）　表單填寫眷屬 ${row.declared_relatives} 人` }),
    el("label", { class: "field-label", text: "報到眷屬人數" }),
    stepper.node,
    el("p", { class: "modal-text", style: "margin-top:16px" }, "金額：", amountText)
  );

  openModal({
    title: "修改報到人數",
    body,
    actions: [
      { label: "取消" },
      {
        label: "確認修改",
        primary: true,
        onClick: async () => {
          try {
            await api.updateRelatives({ empId: row.emp_id, relatives: stepper.value });
            toast(`已更新：${row.name} 眷屬 ${stepper.value} 人，金額 ${formatMoney(calcAmount(stepper.value))}`);
            await refresh();
          } catch (err) {
            toast(errorText(err), "error");
            await refresh();
          }
        },
      },
    ],
  });
}

// ---------- 補登記 ----------

function openWalkIn() {
  const empId = el("input", { class: "input compact", placeholder: "工號，例如 T12345", autocomplete: "off", autocapitalize: "characters" });
  const name = el("input", { class: "input compact", placeholder: "姓名", autocomplete: "off" });
  const unit = el("input", { class: "input compact", placeholder: "單位", autocomplete: "off" });
  const team = el("input", { class: "input compact", placeholder: "小隊（選填）", autocomplete: "off" });
  const error = el("p", { class: "error-text" });
  const stepper = createStepper({ value: 0, min: 0, max: CONFIG.MAX_RELATIVES });

  const body = el(
    "div",
    { class: "form-grid" },
    el("div", {}, el("label", { class: "field-label", text: "工號" }), empId),
    el("div", { class: "form-grid two" }, el("div", {}, el("label", { class: "field-label", text: "姓名" }), name), el("div", {}, el("label", { class: "field-label", text: "單位" }), unit)),
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
            error.textContent = "請填寫姓名與單位";
            return false;
          }
          try {
            const row = await api.registerWalkIn({
              empId: empId.value,
              name: name.value,
              unit: unit.value,
              team: team.value,
              relatives: stepper.value,
              operatorId: WALKIN_OPERATOR,
            });
            toast(`補登記成功：${row.name}（眷屬 ${row.relatives} 人）`);
            await refresh();
            showWalkInLink(row);
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

// 補登記的人沒有信件，把他的領取頁連結給 HR 轉交。
function showWalkInLink(row) {
  const link = new URL(`claim.html?c=${row.seed_code}`, location.href).href;
  openModal({
    title: "已完成補登記",
    body: el(
      "div",
      {},
      el("p", { class: "modal-text", text: `${row.name} 沒有收到信件，請把下列領取頁連結提供給對方：` }),
      el("p", { class: "mono", style: "font-size:13px", text: link })
    ),
    actions: [
      {
        label: "複製連結",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast("已複製連結");
          } catch {
            toast("無法自動複製，請手動選取連結", "error");
          }
          return false;
        },
      },
      { label: "完成", primary: true },
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
