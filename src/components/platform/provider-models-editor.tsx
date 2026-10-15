"use client";

import { useState } from "react";
import { EditableList } from "./editable-list";
import { Field } from "./primitives";

type Model = { name: string; displayName: string };
const emptyModel = (): Model => ({ name: "", displayName: "" });

export function ProviderModelsEditor({
  models,
  disabled,
}: {
  models?: Model[];
  disabled: boolean;
}) {
  const [rows, setRows] = useState<Model[]>(models?.length ? models : [emptyModel()]);
  return (
    <EditableList
      label="模型"
      itemLabel="模型"
      values={rows}
      onChange={setRows}
      createItem={emptyModel}
      min={1}
      max={30}
      disabled={disabled}
      hint="模型 ID 用于调用接口；显示名称用于模型选择，留空时显示模型 ID。最多添加 30 个模型。"
      renderItem={(model, index, update) => (
        <div className="p-form-grid">
          <Field label={`模型 ${index + 1} ID`}>
            <input
              required
              name="modelName"
              maxLength={120}
              disabled={disabled}
              value={model.name}
              onChange={(e) => update({ ...model, name: e.target.value })}
            />
          </Field>
          <Field label={`模型 ${index + 1} 显示名称`}>
            <input
              name="modelDisplayName"
              maxLength={120}
              disabled={disabled}
              value={model.displayName}
              onChange={(e) => update({ ...model, displayName: e.target.value })}
            />
          </Field>
        </div>
      )}
    />
  );
}
