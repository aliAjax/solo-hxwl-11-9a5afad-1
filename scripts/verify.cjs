// 验证脚本：新流程/旧流程/空字段/重复保存/异常输入/筛选/导出一致性/刷新读取
const assert = require("node:assert");
const {
  emptyDraft,
  validateDraft,
  isDuplicateRecord,
  saveStoredRecords,
  loadStoredRecords,
  filterRecords,
  buildCsv,
  ROLES,
  CATEGORIES,
} = require("./records.cjs");

// --- 内存版 localStorage，模拟刷新（重新 load） ---
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("PASS  " + name);
}

const validDraft = {
  ...emptyDraft,
  patientId: "Patient-201",
  role: "验光师",
  category: "儿童",
  examType: "复查",
  uncorrectedVision: "0.6",
  correctedVision: "1.0",
  sphere: "-2.75",
  cylinder: "-0.50",
  axis: "180",
  pd: "62",
  cornealK: "43.25",
  note: "右眼复查",
};

// 1. 新流程：合法草稿通过校验，保存后“刷新”仍能读到，字段一致
check("新流程-保存后刷新可读且字段一致", () => {
  const storage = memoryStorage();
  assert.deepStrictEqual(validateDraft(validDraft), {});
  const rec = { id: "rec-1", ...validDraft, note: "右眼复查", createdAt: "2026-09-12T10:00:00.000Z" };
  const r1 = saveStoredRecords([rec], storage);
  assert.strictEqual(r1.ok, true);
  // 模拟刷新：全新读取
  const reloaded = loadStoredRecords(storage);
  assert.strictEqual(reloaded.length, 1);
  assert.strictEqual(reloaded[0].patientId, "Patient-201");
  assert.strictEqual(reloaded[0].sphere, "-2.75");
  assert.strictEqual(reloaded[0].role, "验光师");
  assert.strictEqual(reloaded[0].cornealK, "43.25");
  assert.ok(!("sample" in reloaded[0]), "示例标记不应写入存储");
});

// 2. 旧流程：无存储时为空数组，不影响三条内置示例（示例在 App 层拼装，此处保证存储不污染）
check("旧流程-无历史存储时读取为空", () => {
  assert.deepStrictEqual(loadStoredRecords(memoryStorage()), []);
});

// 3. 空字段：全空时给出全部必填字段的明确提示
check("空字段-全空返回11项必填提示", () => {
  const errors = validateDraft(emptyDraft);
  const keys = Object.keys(errors);
  assert.strictEqual(keys.length, 11, "应提示 4 个基础字段 + 7 个专业字段");
  for (const k of ["patientId", "role", "category", "examType", "uncorrectedVision", "correctedVision", "sphere", "cylinder", "axis", "pd", "cornealK"]) {
    assert.ok(errors[k], k + " 应有提示");
    assert.ok(errors[k].length > 0);
  }
  assert.ok(/不能为空/.test(errors.sphere));
  assert.ok(/不能为空/.test(errors.patientId));
});

// 4. 空字段：只缺一个专业字段时只报该字段
check("空字段-仅缺瞳距只报瞳距", () => {
  const d = { ...validDraft, pd: "   " };
  const errors = validateDraft(d);
  assert.deepStrictEqual(Object.keys(errors), ["pd"]);
  assert.ok(/瞳距不能为空/.test(errors.pd));
});

// 5. 重复保存：完全相同的草稿第二次保存被拦截（大小写患者编号归一）
check("重复保存-完全一致记录被识别", () => {
  const rec = { id: "rec-1", ...validDraft, createdAt: "2026-09-12T10:00:00.000Z" };
  assert.strictEqual(isDuplicateRecord(validDraft, [rec]), true);
  const upper = { ...validDraft, patientId: "patient-201" };
  assert.strictEqual(isDuplicateRecord(upper, [rec]), true, "大小写不同也算重复");
});

// 6. 重复保存：任一字段不同不算重复；示例记录不参与判定
check("重复保存-字段变化或仅示例记录时不判重", () => {
  const rec = { id: "rec-1", ...validDraft, createdAt: "2026-09-12T10:00:00.000Z" };
  const changed = { ...validDraft, sphere: "-3.00" };
  assert.strictEqual(isDuplicateRecord(changed, [rec]), false);
  const sample = { id: "sample-1", ...validDraft, sample: true, createdAt: "" };
  assert.strictEqual(isDuplicateRecord(validDraft, [sample]), false, "示例记录不参与判重");
});

// 7. 异常输入：每个专业字段的非法值都有明确提示
check("异常输入-各专业字段非法值被拦截", () => {
  const badCases = [
    ["uncorrectedVision", "abc"],
    ["uncorrectedVision", "9.9"],
    ["correctedVision", "2.0"],
    ["sphere", "高度近视"],
    ["sphere", "-99"],
    ["cylinder", "1.00"],
    ["axis", "0"],
    ["axis", "200"],
    ["axis", "abc"],
    ["pd", "30"],
    ["pd", "abc"],
    ["cornealK", "99.0"],
    ["cornealK", "abc"],
  ];
  for (const [key, value] of badCases) {
    const errors = validateDraft({ ...validDraft, [key]: value });
    assert.ok(errors[key], key + "=" + value + " 应报格式异常");
    assert.ok(/格式异常/.test(errors[key]), "提示应含“格式异常”：" + errors[key]);
  }
});

// 8. 异常输入：合法变体（带 + 号、D 后缀、° 符号、mm、小数视力/五分视力）通过
check("异常输入-合法格式变体通过", () => {
  const variants = [
    { uncorrectedVision: "4.9", correctedVision: "5.0" },
    { sphere: "+1.50D", cylinder: "-0.75D" },
    { axis: "180°", pd: "62.5mm" },
  ];
  for (const patch of variants) {
    assert.deepStrictEqual(validateDraft({ ...validDraft, ...patch }), {});
  }
  assert.ok(/患者编号/.test(validateDraft({ ...validDraft, patientId: "张" }).patientId));
});

// 9. 异常输入：枚举被篡改/备注超长
check("异常输入-非法枚举与超长备注", () => {
  assert.ok(validateDraft({ ...validDraft, role: "管理员" }).role);
  assert.ok(validateDraft({ ...validDraft, category: "老花" }).category);
  assert.ok(validateDraft({ ...validDraft, note: "字".repeat(201) }).note);
});

// 10. 筛选：按角色、按分类、组合 AND、全部
check("筛选-角色/分类/组合", () => {
  const mk = (id, role, category) => ({ id, patientId: id, role, category, examType: "复查", uncorrectedVision: "0.8", correctedVision: "1.0", sphere: "-1", cylinder: "-0.5", axis: "90", pd: "62", cornealK: "43", note: "", createdAt: "2026-09-12T10:00:00.000Z" });
  const list = [
    mk("P1", "验光师", "儿童"),
    mk("P2", "复查医生", "儿童"),
    mk("P3", "验光师", "成人"),
    { id: "s1", patientId: "S", role: "", category: "儿童", examType: "复查", uncorrectedVision: "", correctedVision: "", sphere: "", cylinder: "", axis: "", pd: "", cornealK: "", note: "", sample: true, createdAt: "" },
  ];
  assert.deepStrictEqual(filterRecords(list, { role: "", category: "" }).map((r) => r.id), ["P1", "P2", "P3", "s1"]);
  assert.deepStrictEqual(filterRecords(list, { role: "验光师", category: "" }).map((r) => r.id), ["P1", "P3"]);
  assert.deepStrictEqual(filterRecords(list, { role: "", category: "儿童" }).map((r) => r.id), ["P1", "P2", "s1"]);
  assert.deepStrictEqual(filterRecords(list, { role: "验光师", category: "儿童" }).map((r) => r.id), ["P1"]);
  assert.deepStrictEqual(filterRecords(list, { role: "门店顾问", category: "" }), []);
});

// 11. 导出内容与当前列表一致：行数 = 筛选结果数 + 表头，数据值一一对应；逗号被转义
check("导出-CSV 与当前筛选列表完全一致", () => {
  const mk = (id, role, category, note) => ({ id, patientId: id, role, category, examType: "初配", uncorrectedVision: "0.5", correctedVision: "1.0", sphere: "-2.75", cylinder: "-0.50", axis: "180", pd: "62", cornealK: "43.25", note, createdAt: "2026-09-12T10:00:00.000Z" });
  const all = [mk("P1", "验光师", "儿童", ""), mk("P2", "复查医生", "渐进片", "ADD +1.50, 瞳高待确认")];
  const visible = filterRecords(all, { role: "", category: "渐进片" });
  const csv = buildCsv(visible);
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.strictEqual(lines.length, 2, "1 条数据 + 1 行表头");
  assert.ok(lines[0].startsWith("序号,患者编号,角色,分类"));
  assert.ok(lines[1].includes("P2") && lines[1].includes("复查医生") && lines[1].includes("渐进片"));
  assert.ok(!lines[1].includes("P1"), "被筛掉的记录不能出现在导出中");
  assert.ok(lines[1].includes('"ADD +1.50, 瞳高待确认"'), "含逗号字段需加引号");
  const fullCsv = buildCsv(all);
  assert.strictEqual(fullCsv.split("\r\n").length, 3, "无筛选时导出全部 2 条");
});

// 12. 导出空列表：只有表头（界面层会拦截并提示，这里保证函数不产生脏行）
check("导出-空列表仅含表头", () => {
  const lines = buildCsv([]).replace(/^﻿/, "").split("\r\n");
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].startsWith("序号"));
});

// 13. 存储损坏时安全回退，不抛异常
check("持久化-损坏 JSON 回退为空数组", () => {
  const storage = memoryStorage({ "hxwl-11.optometry-records.v1": "{not-json" });
  assert.deepStrictEqual(loadStoredRecords(storage), []);
  const storage2 = memoryStorage({ "hxwl-11.optometry-records.v1": JSON.stringify([{ bad: true }, "x", 42]) });
  assert.deepStrictEqual(loadStoredRecords(storage2), []);
});

// 14. 追加保存多条后刷新顺序与内容一致
check("持久化-多条追加后刷新一致", () => {
  const storage = memoryStorage();
  const mk = (id) => ({ id, patientId: id, role: ROLES[0], category: CATEGORIES[0], examType: "复查", uncorrectedVision: "0.8", correctedVision: "1.0", sphere: "-1.00", cylinder: "-0.25", axis: "90", pd: "60", cornealK: "42.00", note: "", createdAt: "2026-09-12T10:00:00.000Z" });
  saveStoredRecords([mk("A"), mk("B")], storage);
  saveStoredRecords([mk("C"), ...loadStoredRecords(storage)], storage);
  const reloaded = loadStoredRecords(storage);
  assert.deepStrictEqual(reloaded.map((r) => r.patientId), ["C", "A", "B"]);
});

console.log("\n全部 " + passed + " 项验证通过");
