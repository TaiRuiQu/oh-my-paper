"use client";
import type { ProviderSummary } from "@/contracts/ai-providers";
import { useProviderSettings } from "./ai-settings/use-provider-settings";
import { ProviderList } from "./ai-settings/provider-list";
import { ProviderEditor } from "./ai-settings/provider-editor";

export function AiProviderSettings({ initialProviders }: { initialProviders: ProviderSummary[] }) {
  const settings = useProviderSettings(initialProviders);
  return (
    <div className="provider-workspace">
      <ProviderList settings={settings} />
      <ProviderEditor settings={settings} />
    </div>
  );
}
