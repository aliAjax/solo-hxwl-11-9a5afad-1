// 眼科验光记录：数据模型、校验、筛选、持久化与导出
// 纯逻辑模块，便于直接脚本验证，不依赖 React。

export const ROLES = ["验光师", "门店顾问", "复查医生"] as const;
export const CATEGORIES = ["儿童", "成人", "渐进片", "角膜塑形镜"] as const;
export const EXAM_TYPES = ["初配", "复查", "随访"] as const;

export type Role = (typeof ROLES)[number];
export type Category = (typeof CATEGORIES)[number];
export type ExamType = (typeof EXAM_TYPES)[number];

// 旧版七条专业字段，键名固定，顺序即界面与导出列顺序
export const PROFESSIONAL_FIELDS = [
  { key: "uncorrectedVision", label: "裸眼视力" },
  { key: "correctedVision", label: "矫正视力" },
  { key: "sphere", label: "球镜" },
  { key: "cylinder", label: "柱镜" },
  { key: "axis", label: "轴位" },
  { key: "pd", label: "瞳距" },
  { key: "cornealK", label: "角膜曲率" },
] as const;

export type ProfessionalKey = (typeof PROFESSIONAL_FIELDS)[number]["key"];

export interface OptometryRecord {
  id: string;
  patientId: string;
  // 内置旧示例记录没有角色/分类信息，允许空串；新保存记录必填枚举值
  role: Role | "";
  category: Category | "";
  examType: ExamType | "";
  uncorrectedVision: string;
  correctedVision: string;
  sphere: string;
  cylinder: string;
  axis: string;
  pd: string;
  cornealK: string;
  note?: string;
  createdAt: string;
  // 三条内置示例记录标记：保留旧展示文案，不写入 localStorage
  sample?: boolean;
  legacySummary?: string;
}

export interface RecordDraft {
  patientId: string;
  role: string;
  category: string;
  examType: string;
  uncorrectedVision: string;
  correctedVision: string;
  sphere: string;
  cylinder: string;
  axis: string;
  pd: string;
  cornealK: string;
  note: string;
}

export const emptyDraft: RecordDraft = {
  patientId: "",
  role: "",
  category: "",
  examType: "",
  uncorrectedVision: "",
  correctedVision: "",
  sphere: "",
  cylinder: "",
  axis: "",
  pd: "",
  cornealK: "",
  note: "",
};

const PROFESSIONAL_KEYS = PROFESSIONAL_FIELDS.map((f) => f.key);
const PROFESSIONAL_LABEL: Record<ProfessionalKey, string> = Object.fromEntries(
  PROFESSIONAL_FIELDS.map((f) => [f.key, f.label]),
) as Record<ProfessionalKey, string>;

// ---------- 字段格式校验（异常输入提示） ----------

// 视力：小数记法 0.01~1.5（可 1.0、0.8）或五分记法 4.0~5.3
const VISION_RE = /^\d(\.\d{1,2})?$/;

function isValidVision(raw: string): boolean {
  const value = raw.trim();
  if (!VISION_RE.test(value)) return false;
  const num = Number(value);
  return (num >= 0.01 && num <= 1.5) || (num >= 4.0 && num <= 5.3);
}

// 球镜/柱镜：-20.00 ~ +20.00 D，步长 0.25，柱镜一般为负值，这里接受非正
function parseDiopter(raw: string): number | null {
  const value = raw.trim().replace(/[ＤD]$/i, "").replace(/[＋+]/, "+").replace(/[－–—]/, "-");
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(value)) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || Math.abs(num) > 20) return null;
  // 允许 0、0.25 步进（0.12/0.37 等步进也放行，只拦截明显异常）
  return num;
}

function isValidSphere(raw: string): boolean {
  return parseDiopter(raw) !== null;
}

function isValidCylinder(raw: string): boolean {
  const num = parseDiopter(raw);
  return num !== null && num <= 0;
}

function isValidAxis(raw: string): boolean {
  const value = raw.trim().replace(/[°˚]/g, "");
  if (!/^\d{1,3}$/.test(value)) return false;
  const num = Number(value);
  return num >= 1 && num <= 180;
}

function isValidPd(raw: string): boolean {
  const value = raw.trim().replace(/mm$/i, "");
  if (!/^\d{2}(\.\d)?$/.test(value)) return false;
  const num = Number(value);
  return num >= 45 && num <= 80;
}

function isValidCornealK(raw: string): boolean {
  const value = raw.trim().replace(/[ＤD]$/i, "");
  if (!/^\d{2}(\.\d{1,2})?$/.test(value)) return false;
  const num = Number(value);
  return num >= 35 && num <= 48;
}

const PROFESSIONAL_RULES: Record<ProfessionalKey, (v: string) => boolean> = {
  uncorrectedVision: isValidVision,
  correctedVision: isValidVision,
  sphere: isValidSphere,
  cylinder: isValidCylinder,
  axis: isValidAxis,
  pd: isValidPd,
  cornealK: isValidCornealK,
};

const PROFESSIONAL_HINTS: Record<ProfessionalKey, string> = {
  uncorrectedVision: "请输入 0.01~1.5 的小数视力或 4.0~5.3 的五分视力，如 0.8 或 4.9",
  correctedVision: "请输入 0.01~1.5 的小数视力或 4.0~5.3 的五分视力，如 1.0 或 5.0",
  sphere: "请输入 -20.00~+20.00D 的球镜度数，如 -2.75",
  cylinder: "柱镜应为负值或 0，范围 -20.00~0D，如 -0.75",
  axis: "轴位应为 1~180 的整数，如 180",
  pd: "瞳距应为 45~80mm，如 62 或 62.5",
  cornealK: "角膜曲率应为 35.00~48.00D，如 43.25",
};

export type FieldErrors = Partial<Record<keyof RecordDraft, string>>;

function isOneOf<T extends string>(value: string, list: readonly T[]): value is T {
  return (list as readonly string[]).includes(value);
}

// 完整校验：先查空字段，再查异常输入。errors 为空即通过。
export function validateDraft(draft: RecordDraft): FieldErrors {
  const errors: FieldErrors = {};

  const patientId = draft.patientId.trim();
  if (!patientId) {
    errors.patientId = "患者编号不能为空";
  } else if (!/^[A-Za-z0-9-_]{2,20}$/.test(patientId)) {
    errors.patientId = "患者编号需为 2~20 位字母、数字、连字符或下划线";
  }

  if (!draft.role) errors.role = "请选择角色";
  else if (!isOneOf(draft.role, ROLES)) errors.role = "角色不在可选范围内";

  if (!draft.category) errors.category = "请选择分类";
  else if (!isOneOf(draft.category, CATEGORIES)) errors.category = "分类不在可选范围内";

  if (!draft.examType) errors.examType = "请选择初配/复查/随访";
  else if (!isOneOf(draft.examType, EXAM_TYPES)) errors.examType = "类型不在可选范围内";

  for (const key of PROFESSIONAL_KEYS) {
    const value = draft[key].trim();
    if (!value) {
      errors[key] = PROFESSIONAL_LABEL[key] + "不能为空";
    } else if (!PROFESSIONAL_RULES[key](value)) {
      errors[key] = PROFESSIONAL_LABEL[key] + "格式异常：" + PROFESSIONAL_HINTS[key];
    }
  }

  if (draft.note.trim().length > 200) {
    errors.note = "备注不能超过 200 字";
  }

  return errors;
}

// ---------- 重复保存判定 ----------

// 同一患者 + 相同角色/分类/类型 + 七项专业字段完全一致即视为重复
export function recordSignature(input: RecordDraft | OptometryRecord): string {
  return [
    input.patientId.trim().toUpperCase(),
    input.role,
    input.category,
    input.examType,
    ...PROFESSIONAL_KEYS.map((key) => input[key].trim()),
  ].join("|");
}

export function isDuplicateRecord(draft: RecordDraft, records: OptometryRecord[], target?: OptometryRecord): boolean {
  // 示例记录不参与重复判定；编辑时排除自身
  const signature = recordSignature(draft);
  return records.some((record) => {
    if (record.sample) return false;
    if (target && record.id === target.id) return false;
    return recordSignature(record) === signature;
  });
}

// ---------- 持久化（localStorage，异常时回退内存） ----------

const STORAGE_KEY = "hxwl-11.optometry-records.v1";

export function loadStoredRecords(storage?: Storage | null): OptometryRecord[] {
  const store = storage ?? getSafeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => normalizeStored(item))
      .filter((r): r is OptometryRecord => r !== null);
  } catch {
    return [];
  }
}

function normalizeStored(item: Record<string, unknown>): OptometryRecord | null {
  const required = ["id", "patientId", "role", "category", "examType", "createdAt", ...PROFESSIONAL_KEYS];
  if (!required.every((key) => typeof item[key] === "string")) return null;
  if (!isOneOf(item.role as string, ROLES)) return null;
  if (!isOneOf(item.category as string, CATEGORIES)) return null;
  if (!isOneOf(item.examType as string, EXAM_TYPES)) return null;
  return {
    id: item.id as string,
    patientId: item.patientId as string,
    role: item.role as Role,
    category: item.category as Category,
    examType: item.examType as ExamType,
    uncorrectedVision: item.uncorrectedVision as string,
    correctedVision: item.correctedVision as string,
    sphere: item.sphere as string,
    cylinder: item.cylinder as string,
    axis: item.axis as string,
    pd: item.pd as string,
    cornealK: item.cornealK as string,
    note: typeof item.note === "string" ? item.note : "",
    createdAt: item.createdAt as string,
  };
}

export function saveStoredRecords(records: OptometryRecord[], storage?: Storage | null): { ok: boolean; error?: string } {
  const store = storage ?? getSafeStorage();
  if (!store) {
    return { ok: false, error: "浏览器存储不可用，本次记录仅在当前页面有效" };
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(records.map((r) => stripSample(r))));
    return { ok: true };
  } catch {
    return { ok: false, error: "本地存储空间不足，记录未能保存" };
  }
}

function stripSample(record: OptometryRecord): OptometryRecord {
  const { sample: _sample, legacySummary: _legacy, ...rest } = record;
  return rest as OptometryRecord;
}

function getSafeStorage(): Storage | null {
  try {
    const test = "__hxwl_storage_test__";
    window.localStorage.setItem(test, "1");
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------- 筛选：角色与分类可叠加（AND） ----------

export interface RecordFilter {
  role: string; // "" 表示全部
  category: string; // "" 表示全部
}

export function filterRecords(records: OptometryRecord[], filter: RecordFilter): OptometryRecord[] {
  return records.filter((record) => {
    if (filter.role && record.role !== filter.role) return false;
    if (filter.category && record.category !== filter.category) return false;
    return true;
  });
}

// ---------- 导出：内容与当前列表完全一致 ----------

const EXPORT_COLUMNS = [
  "序号",
  "患者编号",
  "角色",
  "分类",
  "类型",
  "裸眼视力",
  "矫正视力",
  "球镜",
  "柱镜",
  "轴位",
  "瞳距(mm)",
  "角膜曲率(D)",
  "备注",
  "记录时间",
];

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function buildCsv(records: OptometryRecord[]): string {
  const rows = records.map((record, index) =>
    [
      String(index + 1),
      record.patientId,
      record.role,
      record.category,
      record.examType,
      record.uncorrectedVision,
      record.correctedVision,
      record.sphere,
      record.cylinder,
      record.axis,
      record.pd,
      record.cornealK,
      record.note ?? "",
      formatTime(record.createdAt),
    ]
      .map((cell) => csvEscape(cell))
      .join(","),
  );
  // BOM 保证 Excel 打开中文不乱码
  return "﻿" + [EXPORT_COLUMNS.join(","), ...rows].join("\r\n");
}

export function exportFilename(now = new Date()): string {
  return "眼科验光记录_" + formatDate(now) + ".csv";
}

export function downloadCsv(records: OptometryRecord[], now = new Date()): void {
  const csv = buildCsv(records);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(now);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------- 时间展示 ----------

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate());
}
