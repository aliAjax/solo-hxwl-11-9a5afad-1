import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  CATEGORIES,
  EXAM_TYPES,
  PROFESSIONAL_FIELDS,
  ROLES,
  emptyDraft,
  downloadCsv,
  filterRecords,
  formatTime,
  isDuplicateRecord,
  loadStoredRecords,
  saveStoredRecords,
  validateDraft,
  type FieldErrors,
  type OptometryRecord,
  type RecordDraft,
} from "./records";

const project = {
  "id": "hxwl-11",
  "port": 5111,
  "title": "眼科验光记录",
  "subtitle": "视力、屈光参数与复查处方对比",
  "stack": "React + Vite + TypeScript + CSS",
  "theme": [
    "#2563eb",
    "#059669",
    "#dc2626"
  ],
  "domain": "眼视光",
  "users": [
    "验光师",
    "门店顾问",
    "复查医生"
  ],
  "metrics": [
    "近视进展",
    "散光变化",
    "复查提醒",
    "处方数量"
  ],
  "filters": [
    "儿童",
    "成人",
    "渐进片",
    "角膜塑形镜"
  ],
  "fields": [
    "裸眼视力",
    "矫正视力",
    "球镜",
    "柱镜",
    "轴位",
    "瞳距",
    "角膜曲率"
  ],
  "records": [
    [
      "Patient-032",
      "儿童近视",
      "复查",
      "右眼-2.75DS，轴位180"
    ],
    [
      "Patient-081",
      "渐进片",
      "初配",
      "ADD +1.50，瞳高待确认"
    ],
    [
      "Patient-144",
      "散光",
      "复查",
      "柱镜变化0.50D"
    ]
  ]
};

const statusColors = ["status-ok", "status-watch", "status-danger"];

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

// 旧版三条示例记录：保留原始展示文案，分类按旧筛选项做兼容映射
function mapLegacyCategory(label: string): string {
  if (label.includes("儿童")) return "儿童";
  if (label.includes("成人")) return "成人";
  if (label.includes("渐进片")) return "渐进片";
  if (label.includes("角膜塑形镜") || label.includes("塑形")) return "角膜塑形镜";
  return "";
}

function buildSampleRecords(): OptometryRecord[] {
  return project.records.map((record, index) => ({
    id: "sample-" + (index + 1),
    patientId: record[0],
    role: "",
    category: mapLegacyCategory(record[1]) as OptometryRecord["category"],
    examType: (record[2] === "初配" || record[2] === "复查" || record[2] === "随访" ? record[2] : "复查") as OptometryRecord["examType"],
    uncorrectedVision: "",
    correctedVision: "",
    sphere: "",
    cylinder: "",
    axis: "",
    pd: "",
    cornealK: "",
    note: "",
    createdAt: "",
    sample: true,
    legacySummary: record.slice(1).join(" · "),
  }));
}

type ToastKind = "success" | "error" | "info";

interface Toast {
  kind: ToastKind;
  text: string;
}

function App() {
  const values = project.metrics.map((metric: string, index: number) => {
    const base = [84, 12, 31, 7][index % 4];
    return String(base + index * 3);
  });

  const [storedRecords, setStoredRecords] = useState<OptometryRecord[]>(() => loadStoredRecords());
  const sampleRecords = useMemo(buildSampleRecords, []);
  // 示例记录始终在最前，保持旧版 01~03 编号与顺序
  const records = useMemo(() => [...sampleRecords, ...storedRecords], [sampleRecords, storedRecords]);

  const [draft, setDraft] = useState<RecordDraft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [toast, setToast] = useState<Toast | null>(null);
  const patientInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleRecords = useMemo(
    () => filterRecords(records, { role: roleFilter, category: categoryFilter }),
    [records, roleFilter, categoryFilter],
  );

  function updateField(key: keyof RecordDraft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // 旧入口「新增记录」：清空表单，准备录入下一条
  function startNewRecord() {
    setDraft(emptyDraft);
    setErrors({});
    setToast({ kind: "info", text: "已准备新记录，请填写患者信息和验光字段" });
    patientInputRef.current?.focus();
    patientInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetForm() {
    setDraft(emptyDraft);
    setErrors({});
  }

  // 保存：先做空字段/异常输入校验，再拦截重复保存，最后持久化（刷新后仍可读到）
  function handleSave() {
    const validationErrors = validateDraft(draft);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      const count = Object.keys(validationErrors).length;
      setToast({
        kind: "error",
        text: "保存失败：有 " + count + " 项为空或格式异常，请按红字提示修改后再保存",
      });
      return;
    }

    if (isDuplicateRecord(draft, records)) {
      setToast({
        kind: "error",
        text: "重复保存：该患者编号、角色、分类、类型与全部验光字段与已有记录完全相同",
      });
      return;
    }

    const record: OptometryRecord = {
      id: "rec-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      patientId: draft.patientId.trim(),
      role: draft.role as OptometryRecord["role"],
      category: draft.category as OptometryRecord["category"],
      examType: draft.examType as OptometryRecord["examType"],
      uncorrectedVision: draft.uncorrectedVision.trim(),
      correctedVision: draft.correctedVision.trim(),
      sphere: draft.sphere.trim(),
      cylinder: draft.cylinder.trim(),
      axis: draft.axis.trim(),
      pd: draft.pd.trim(),
      cornealK: draft.cornealK.trim(),
      note: draft.note.trim(),
      createdAt: new Date().toISOString(),
    };

    const nextStored = [record, ...storedRecords];
    const result = saveStoredRecords(nextStored);
    setStoredRecords(nextStored);
    resetForm();

    if (result.ok) {
      setToast({ kind: "success", text: "保存成功，记录已写入本地，刷新页面后仍可读取" });
    } else {
      setToast({ kind: "error", text: result.error ?? "保存失败，请重试" });
    }
  }

  // 导出：严格导出当前筛选后的列表
  function handleExport() {
    if (visibleRecords.length === 0) {
      setToast({ kind: "error", text: "当前列表为空，没有可导出的记录" });
      return;
    }
    try {
      downloadCsv(visibleRecords);
      setToast({
        kind: "success",
        text: "已导出 " + visibleRecords.length + " 条记录，内容与当前列表一致",
      });
    } catch {
      setToast({ kind: "error", text: "导出失败：浏览器阻止了文件下载，请重试" });
    }
  }

  return (
    <main className="app-shell">
      {toast && (
        <div className={"toast toast-" + toast.kind} role="status">
          {toast.text}
        </div>
      )}

      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {project.metrics.map((metric: string, index: number) => (
          <MetricCard key={metric} label={metric} value={values[index]} index={index} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {project.users.map((user: string) => (
              <span key={user}>{user}</span>
            ))}
          </div>
          <h2>角色筛选</h2>
          <div className="chips filter-chips" role="group" aria-label="按角色筛选">
            <button
              className={roleFilter === "" ? "chip-active" : ""}
              aria-pressed={roleFilter === ""}
              onClick={() => setRoleFilter("")}
            >
              全部
            </button>
            {ROLES.map((role) => (
              <button
                key={role}
                className={roleFilter === role ? "chip-active" : ""}
                aria-pressed={roleFilter === role}
                onClick={() => setRoleFilter(role)}
              >
                {role}
              </button>
            ))}
          </div>
          <h2>筛选</h2>
          <div className="chips muted filter-chips" role="group" aria-label="按分类筛选">
            <button
              className={categoryFilter === "" ? "chip-active" : ""}
              aria-pressed={categoryFilter === ""}
              onClick={() => setCategoryFilter("")}
            >
              全部
            </button>
            {project.filters.map((filter: string) => (
              <button
                key={filter}
                className={categoryFilter === filter ? "chip-active" : ""}
                aria-pressed={categoryFilter === filter}
                onClick={() => setCategoryFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        </aside>

        <section className="panel" id="record-form-panel">
          <div className="section-heading">
            <div>
              <p>{project.domain}</p>
              <h2>记录字段</h2>
            </div>
            <button className="primary-action" onClick={startNewRecord}>新增记录</button>
          </div>
          <div className="field-grid">
            <label>
              <span>患者编号 *</span>
              <input
                ref={patientInputRef}
                className={errors.patientId ? "invalid" : ""}
                placeholder="如 Patient-201"
                value={draft.patientId}
                maxLength={20}
                onChange={(event) => updateField("patientId", event.target.value)}
              />
              {errors.patientId && <em className="field-error">{errors.patientId}</em>}
            </label>
            <label>
              <span>角色 *</span>
              <select
                className={errors.role ? "invalid" : ""}
                value={draft.role}
                onChange={(event) => updateField("role", event.target.value)}
              >
                <option value="">请选择角色</option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              {errors.role && <em className="field-error">{errors.role}</em>}
            </label>
            <label>
              <span>分类 *</span>
              <select
                className={errors.category ? "invalid" : ""}
                value={draft.category}
                onChange={(event) => updateField("category", event.target.value)}
              >
                <option value="">请选择分类</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              {errors.category && <em className="field-error">{errors.category}</em>}
            </label>
            <label>
              <span>类型 *</span>
              <select
                className={errors.examType ? "invalid" : ""}
                value={draft.examType}
                onChange={(event) => updateField("examType", event.target.value)}
              >
                <option value="">请选择类型</option>
                {EXAM_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {errors.examType && <em className="field-error">{errors.examType}</em>}
            </label>
            {PROFESSIONAL_FIELDS.map((field) => {
              const fieldError = errors[field.key];
              return (
                <label key={field.key}>
                  <span>{field.label} *</span>
                  <input
                    className={fieldError ? "invalid" : ""}
                    placeholder={"填写" + field.label}
                    value={draft[field.key]}
                    onChange={(event) => updateField(field.key, event.target.value)}
                  />
                  {fieldError && <em className="field-error">{fieldError}</em>}
                </label>
              );
            })}
            <label className="field-full">
              <span>备注（选填，最多 200 字）</span>
              <input
                className={errors.note ? "invalid" : ""}
                placeholder="如 ADD +1.50，瞳高待确认"
                value={draft.note}
                maxLength={200}
                onChange={(event) => updateField("note", event.target.value)}
              />
              {errors.note && <em className="field-error">{errors.note}</em>}
            </label>
          </div>
          <div className="form-actions">
            <button className="primary-action" onClick={handleSave}>保存记录</button>
            <button onClick={resetForm}>清空</button>
          </div>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>示例数据</p>
            <h2>近期记录</h2>
          </div>
          <div className="records-actions">
            <span className="list-count">当前列表 {visibleRecords.length} 条</span>
            <button onClick={handleExport}>导出摘要</button>
          </div>
        </div>
        <div className="record-list">
          {visibleRecords.length === 0 && (
            <p className="empty-tip">当前筛选条件下暂无记录，可切换角色/分类或新增一条记录</p>
          )}
          {visibleRecords.map((record, index) =>
            record.sample ? (
              <article key={record.id} className="record-card">
                <div className="record-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <h3>
                    {record.patientId}
                    <span className="sample-tag">示例</span>
                  </h3>
                  <p>{record.legacySummary}</p>
                </div>
              </article>
            ) : (
              <article key={record.id} className="record-card record-card-detail">
                <div className="record-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <h3>{record.patientId}</h3>
                  <p className="record-meta">
                    <span>{record.role}</span>
                    <span>{record.category}</span>
                    <span>{record.examType}</span>
                    <time>{formatTime(record.createdAt)}</time>
                  </p>
                  <div className="record-fields">
                    {PROFESSIONAL_FIELDS.map((field) => (
                      <span key={field.key}>
                        <b>{field.label}</b>
                        {record[field.key]}
                      </span>
                    ))}
                  </div>
                  {record.note && <p className="record-note">备注：{record.note}</p>}
                </div>
              </article>
            ),
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
