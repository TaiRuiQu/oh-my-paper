"use client";
import { useState } from "react";
import { ArrowLeft, Check, Plus, Pencil, Trash2 } from "lucide-react";
import type { XiaozhiSkill } from "@/contracts/xiaozhi";
import { MarkdownText } from "@/components/markdown-text";

export function SkillsPanel({
  skills,
  selected,
  locked,
  onSelect,
  onChanged,
}: {
  skills: XiaozhiSkill[];
  selected: string[];
  locked: boolean;
  onSelect: (ids: string[]) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<XiaozhiSkill | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edit = (skill: XiaozhiSkill | null) => {
    setDetail(skill);
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setInstructions(skill?.instructions ?? "");
    setEditing(true);
    setError("");
  };
  const mutate = async (method: string, body?: unknown) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/xiaozhi/skills${detail ? `/${detail.id}` : ""}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "技能保存失败，请重试。");
      if (method === "DELETE" && detail && selected.includes(detail.id))
        await onSelect(selected.filter((id) => id !== detail.id));
      await onChanged();
      setDetail(null);
      setEditing(false);
      setConfirmDelete(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  if (editing)
    return (
      <form
        className="xz-skill-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(detail ? "PUT" : "POST", { name, description, instructions });
        }}
      >
        <button
          type="button"
          className="xz-text-button"
          onClick={() => {
            setEditing(false);
            setDetail(null);
          }}
        >
          <ArrowLeft size={15} />
          返回技能库
        </button>
        <label htmlFor="xz-skill-name">技能名称</label>
        <input
          id="xz-skill-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={60}
          placeholder="例如：每周数学备课"
        />
        <label htmlFor="xz-skill-description">什么时候使用</label>
        <input
          id="xz-skill-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
          maxLength={300}
          placeholder="用一句话告诉小纸这个技能的用途"
        />
        <label htmlFor="xz-skill-instructions">工作方法</label>
        <textarea
          id="xz-skill-instructions"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          required
          maxLength={20000}
          rows={12}
          placeholder="写下目标、需要查看的资料、操作原则和结果要求。小纸会按实际情况自主执行。"
        />
        {error && (
          <p className="xz-field-error" role="alert">
            {error}
          </p>
        )}
        <button className="xz-primary-button" disabled={saving}>
          {saving ? "正在保存…" : "保存技能"}
        </button>
      </form>
    );
  if (detail)
    return (
      <div className="xz-skill-detail">
        <button
          className="xz-text-button"
          onClick={() => {
            setDetail(null);
            setConfirmDelete(false);
          }}
        >
          <ArrowLeft size={15} />
          返回技能库
        </button>
        <h3>{detail.name}</h3>
        <p>{detail.description}</p>
        <MarkdownText text={detail.instructions} />
        <div className="xz-skill-detail-actions">
          <button
            className="xz-primary-button"
            disabled={locked || saving}
            onClick={() =>
              void onSelect(
                selected.includes(detail.id)
                  ? selected.filter((id) => id !== detail.id)
                  : [...selected, detail.id],
              )
            }
          >
            {selected.includes(detail.id) ? "取消选用" : "在此对话中选用"}
          </button>
          {!detail.builtin && (
            <>
              <button className="xz-text-button" disabled={saving} onClick={() => edit(detail)}>
                <Pencil size={14} />
                编辑
              </button>
              <button
                className="xz-text-button xz-danger"
                disabled={saving || locked}
                onClick={() => {
                  if (confirmDelete) void mutate("DELETE");
                  else setConfirmDelete(true);
                }}
              >
                <Trash2 size={14} />
                {confirmDelete ? "确认删除" : "删除"}
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="xz-field-error">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="xz-skills-panel">
      <div className="xz-skills-intro">
        <p>小纸会自行查找适合的技能。选用后，它会在这段对话中优先参考你的工作方法。</p>
        <button className="xz-text-button" onClick={() => edit(null)}>
          <Plus size={16} />
          编写技能
        </button>
      </div>
      {locked && <p className="xz-skills-locked">请先停止当前任务，再调整此对话的技能。</p>}
      <div className="xz-skill-list">
        {skills.map((skill) => (
          <div className="xz-skill-row" key={skill.id}>
            <button className="xz-skill-description" onClick={() => setDetail(skill)}>
              <span>
                {skill.name}
                {!skill.builtin && <small>个人技能</small>}
              </span>
              <p>{skill.description}</p>
            </button>
            <button
              className={`xz-skill-toggle${selected.includes(skill.id) ? " selected" : ""}`}
              aria-label={`${selected.includes(skill.id) ? "取消选用" : "选用"}${skill.name}`}
              aria-pressed={selected.includes(skill.id)}
              disabled={locked}
              onClick={() =>
                void onSelect(
                  selected.includes(skill.id)
                    ? selected.filter((id) => id !== skill.id)
                    : [...selected, skill.id],
                )
              }
            >
              {selected.includes(skill.id) ? <Check size={16} /> : <Plus size={16} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
