"use client";

import { useState } from "react";
import { EditableList } from "./editable-list";
import { Field } from "./primitives";
import {
  reasoningEfforts,
  reasoningEffortLabels,
  type ReasoningEffort,
} from "@/contracts/ai-models";

type Model = { name: string; displayName: string; reasoningEffort: ReasoningEffort };
const emptyModel = (): Model => ({
  name: "",
  displayName: "",
  reasoningEffort: "provider-default",
});

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
        <div className="p-form-grid p-provider-model-fields">
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
          <Field
            label={`模型 ${index + 1} 思考强度`}
            hint="更充分的思考通常耗时更长。按模型支持的档位选择，或使用供应商默认设置。"
          >
            <select
              name="modelReasoningEffort"
              disabled={disabled}
              value={model.reasoningEffort}
              onChange={(e) =>
                update({ ...model, reasoningEffort: e.target.value as ReasoningEffort })
              }
            >
              {reasoningEfforts.map((effort) => (
                <option key={effort} value={effort}>
                  {reasoningEffortLabels[effort]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    />
  );
}
