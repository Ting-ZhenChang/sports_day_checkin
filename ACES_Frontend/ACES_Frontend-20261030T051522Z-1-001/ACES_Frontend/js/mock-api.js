// 模擬後端（Prototype）：資料存在瀏覽器 localStorage，結構對應會議決議的 3 張表。
//   employees = 主表   （工號、姓名、單位、小隊、眷屬填寫數、Email、種子碼）
//   checkins  = 報到表 （工號、報到負責人工號、報到時間、報到人數、是否報到 0/1）
//   receipts  = 簽收表 （工號、領取碼、簽收人工號、簽收時間、是否領取 0/1）
// 金額只存在「主表」概念上，隨報到人數即時重算；這裡以 calcAmount() 動態計算。
//
// 後端完成後，只要寫一份同樣函式簽章的 rest-api.js 取代本檔即可，頁面程式不用改。
// 資料不會在不同裝置間共用（只在同一瀏覽器的各頁面共用），跨裝置測試請等真後端。

class ApiError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const api = (() => {
  const KEY = "aces_mock_db_v2";

  // 示範資料。種子碼為 16 碼英文大小寫 + 數字（與正式規格相同）。
  const DEMO_EMPLOYEES = [
    ["T10001", "王小明", "數位轉型部", "紅隊", 3, "xiaoming.wang@example.com", "Kx9TmQ2vB7aLpR4s"],
    ["T10002", "林小花", "財務部", "藍隊", 0, "xiaohua.lin@example.com", "Qw3ZnY8cD5eHjU1t"],
    ["11110003", "陳小華", "人力資源部", "綠隊", 2, "xiaohua.chen@example.com", "Mb7RfG4kS9xVtN2p"],
    ["T10004", "張美玲", "行銷部", "紅隊", 5, "meiling.chang@example.com", "Ld2WpE6oJ8yCaB5q"],
    ["T10005", "李大偉", "研發部", "黃隊", 1, "dawei.li@example.com", "Hs5XcT1uK3nZgF9r"],
    ["11110006", "黃雅婷", "業務部", "藍隊", 4, "yating.huang@example.com", "Vn8DjA3mP6bQwL7e"],
    ["T10007", "吳志豪", "研發部", "綠隊", 0, "chihao.wu@example.com", "Gt4YhR9iC2sMfK6x"],
    ["T10008", "Emily Carter", "國際業務部", "黃隊", 2, "emily.carter@example.com", "Bz6UeN1vH5tWoD3a"],
    ["T10009", "劉建宏", "資訊部", "紅隊", 3, "jianhong.liu@example.com", "Pc9SaL4gX7dJrM2y"],
    ["T10010", "蔡淑芬", "總務部", "藍隊", 1, "shufen.tsai@example.com", "Ek3NwB8qF1zYhT5u"],
  ];

  function demoDb() {
    return {
      employees: DEMO_EMPLOYEES.map(([emp_id, name, unit, team, declared_relatives, email, seed_code]) => ({
        emp_id, name, unit, team, declared_relatives, email, seed_code, walk_in: false,
      })),
      checkins: [],
      receipts: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // 資料損毀時重建示範資料
    }
    const db = demoDb();
    save(db);
    return db;
  }

  function save(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
  }

  function nowString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // 英文大小寫 + 數字，無特殊符號。
  function randomCode(length = 16) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  function uniqueCode(db, used) {
    let code;
    do {
      code = randomCode();
    } while (used(code));
    return code;
  }

  // 把三張表合成頁面使用的一列資料。
  function joinRow(db, emp) {
    const checkin = db.checkins.find((c) => c.emp_id === emp.emp_id);
    const receipt = db.receipts.find((r) => r.emp_id === emp.emp_id);
    const checkedIn = checkin ? 1 : 0;
    return {
      emp_id: emp.emp_id,
      name: emp.name,
      unit: emp.unit,
      team: emp.team,
      email: emp.email,
      seed_code: emp.seed_code,
      walk_in: Boolean(emp.walk_in),
      declared_relatives: emp.declared_relatives,
      checked_in: checkedIn,
      relatives: checkin ? checkin.relatives : null,
      amount: checkin ? calcAmount(checkin.relatives) : null,
      checked_in_at: checkin ? checkin.checked_in_at : null,
      operator_id: checkin ? checkin.operator_id : null,
      claim_code: receipt ? receipt.claim_code : null,
      claim_created_at: receipt ? receipt.created_at : null,
      claimed: receipt ? receipt.claimed : 0,
      signer_id: receipt ? receipt.signer_id : null,
      signed_at: receipt ? receipt.signed_at : null,
    };
  }

  function findBySeed(db, seed) {
    const emp = db.employees.find((e) => e.seed_code === String(seed || "").trim());
    if (!emp) throw new ApiError("NOT_FOUND");
    return emp;
  }

  function requireOperator(operatorId) {
    if (!isValidEmpId(operatorId)) throw new ApiError("INVALID_OPERATOR");
    return normalizeEmpId(operatorId);
  }

  function requireRelatives(value, max) {
    if (!Number.isInteger(value) || value < 0 || value > max) throw new ApiError("INVALID_RELATIVES", { max });
    return value;
  }

  const ok = (value) => Promise.resolve(value);
  const fail = (err) => Promise.reject(err);
  const run = (fn) => {
    try {
      return ok(fn());
    } catch (err) {
      return fail(err);
    }
  };

  return {
    // 員工掃 QR / 報到工作人員掃 QR：依種子碼查詢。
    lookupBySeed: (seed) =>
      run(() => {
        const db = load();
        return joinRow(db, findBySeed(db, seed));
      }),

    // 報到：寫入報到負責人工號、系統時間，是否報到 0 → 1；已報到者不能重複。
    checkIn: ({ seed, operatorId, relatives }) =>
      run(() => {
        const db = load();
        const operator = requireOperator(operatorId);
        const emp = findBySeed(db, seed);
        if (db.checkins.some((c) => c.emp_id === emp.emp_id)) throw new ApiError("ALREADY_CHECKED_IN");
        requireRelatives(relatives, maxRelativesFor(emp.declared_relatives));

        db.checkins.push({ emp_id: emp.emp_id, operator_id: operator, checked_in_at: nowString(), relatives, checked_in: 1 });
        save(db);
        return joinRow(db, emp);
      }),

    // 員工確認後產生領取碼（寫入簽收表，是否領取仍為 0）。重複確認回傳同一組領取碼。
    confirmClaim: (seed) =>
      run(() => {
        const db = load();
        const emp = findBySeed(db, seed);
        if (!db.checkins.some((c) => c.emp_id === emp.emp_id)) throw new ApiError("NOT_CHECKED_IN");

        const receipt = db.receipts.find((r) => r.emp_id === emp.emp_id);
        if (receipt && receipt.claimed) throw new ApiError("ALREADY_CLAIMED");
        if (!receipt) {
          const code = uniqueCode(db, (c) => db.receipts.some((r) => r.claim_code === c));
          db.receipts.push({ emp_id: emp.emp_id, claim_code: code, signer_id: null, signed_at: null, claimed: 0, created_at: nowString() });
          save(db);
        }
        return joinRow(db, emp);
      }),

    // HR 掃領取碼：寫入簽收人、時間，是否領取 0 → 1；掃完才算交易完成。
    signReceipt: ({ claimCode, signerId }) =>
      run(() => {
        const db = load();
        const signer = requireOperator(signerId);
        const receipt = db.receipts.find((r) => r.claim_code === String(claimCode || "").trim());
        if (!receipt) throw new ApiError("NOT_FOUND");

        const emp = db.employees.find((e) => e.emp_id === receipt.emp_id);
        if (receipt.claimed) throw new ApiError("ALREADY_CLAIMED", { row: joinRow(db, emp) });

        receipt.claimed = 1;
        receipt.signer_id = signer;
        receipt.signed_at = nowString();
        save(db);
        return joinRow(db, emp);
      }),

    // HR 看板：全部資料。
    listRecords: () =>
      run(() => {
        const db = load();
        return db.employees.map((e) => joinRow(db, e));
      }),

    // HR 修改報到人數（最高修改權，0 ~ 上限）；金額隨人數重算。已簽收的不可改。
    updateRelatives: ({ empId, relatives }) =>
      run(() => {
        const db = load();
        const emp = db.employees.find((e) => e.emp_id === empId);
        if (!emp) throw new ApiError("NOT_FOUND");
        const checkin = db.checkins.find((c) => c.emp_id === empId);
        if (!checkin) throw new ApiError("NOT_CHECKED_IN");
        const receipt = db.receipts.find((r) => r.emp_id === empId);
        if (receipt && receipt.claimed) throw new ApiError("ALREADY_CLAIMED");
        requireRelatives(relatives, CONFIG.MAX_RELATIVES);

        checkin.relatives = relatives;
        save(db);
        return joinRow(db, emp);
      }),

    // HR 補登記：沒填表單 / 晚到者。工號已存在（含後 5 碼相同）則直接補報到，不重複建立。
    registerWalkIn: ({ empId, name, unit, team, relatives, operatorId }) =>
      run(() => {
        const db = load();
        if (!isValidEmpId(empId)) throw new ApiError("INVALID_EMP_ID");
        if (!String(name || "").trim() || !String(unit || "").trim()) throw new ApiError("MISSING_FIELDS");
        requireRelatives(relatives, CONFIG.MAX_RELATIVES);
        // 看板不做登入，操作人不是工號時以 "HR" 記錄。
        const operator = String(operatorId || "HR").trim();

        const id = normalizeEmpId(empId);
        let emp = db.employees.find((e) => empKey(e.emp_id) === empKey(id));
        if (emp && db.checkins.some((c) => c.emp_id === emp.emp_id)) throw new ApiError("ALREADY_CHECKED_IN");
        if (!emp) {
          emp = {
            emp_id: id,
            name: String(name).trim(),
            unit: String(unit).trim(),
            team: String(team || "").trim() || "-",
            declared_relatives: relatives,
            email: "",
            seed_code: uniqueCode(db, (c) => db.employees.some((e) => e.seed_code === c)),
            walk_in: true,
          };
          db.employees.push(emp);
        }
        db.checkins.push({ emp_id: emp.emp_id, operator_id: operator, checked_in_at: nowString(), relatives, checked_in: 1 });
        save(db);
        return joinRow(db, emp);
      }),

    // 僅供 Prototype 導覽頁使用。
    resetDemo: () =>
      run(() => {
        save(demoDb());
      }),
  };
})();
