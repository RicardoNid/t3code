import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";

import {
  useClientSettings,
  useClientSettingsHydrated,
  updateClientSettings,
} from "~/hooks/useSettings";
import type { MessageResolver } from "~/i18n/messages";
import type { EnvironmentPresentation } from "~/state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { EnvironmentRow, EnvironmentTransportLabel } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

const preferences = [
  { value: 100, label: msg("Prefer") },
  { value: 50, label: msg("Normal", { $context: "load balancing preference" }) },
  { value: 25, label: msg("Less often") },
  { value: 0, label: msg("Manual only") },
] as const;

const summaryLabels = {
  100: msg("{environment} prefer"),
  25: msg("{environment} less often"),
  0: msg("{environment} manual only"),
} as const;

type LoadPreference = (typeof preferences)[number]["value"];

function loadPreferenceForWeight(weight: number | undefined): LoadPreference {
  if (weight === undefined || weight === 50) return 50;
  if (weight === 0) return 0;
  return weight < 50 ? 25 : 100;
}

function summarizeLoadPreferences(
  environments: ReadonlyArray<Pick<EnvironmentPresentation, "environmentId" | "label">>,
  weights: Readonly<Record<string, number>>,
  resolve: MessageResolver,
): string | null {
  const parts = environments.flatMap((environment) => {
    const preference = loadPreferenceForWeight(weights[environment.environmentId]);
    return preference === 50
      ? []
      : [resolve(summaryLabels[preference], { environment: environment.label })];
  });
  return parts.length === 0 ? null : parts.join(" · ");
}

export function LoadBalancingSettings({
  environments,
}: {
  environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const searchableSetting = useSearchableSetting();
  const settings = useClientSettings((current) => ({
    loadBalancingEnabled: current.loadBalancingEnabled,
    loadBalancingWeights: current.loadBalancingWeights,
    loadBalancingStrategy: current.loadBalancingStrategy,
  }));
  const settingsHydrated = useClientSettingsHydrated();
  const gt = useGT();
  const m = useMessages();
  const items = preferences.map((entry) => ({ ...entry, label: m(entry.label) }));

  if (environments.length < 2) return null;

  const { id, title } = searchableSetting("load-balancing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        settings.loadBalancingEnabled
          ? [
              settings.loadBalancingStrategy === "usage"
                ? gt("Usage", { $context: "routing strategy" })
                : gt("Hardware", { $context: "routing strategy" }),
              summarizeLoadPreferences(environments, settings.loadBalancingWeights, m),
            ]
              .filter(Boolean)
              .join(" · ")
          : gt("Off", { $context: "load balancing is turned off" })
      }
      control={
        <Switch
          aria-label={gt("Automatically balance load")}
          checked={settings.loadBalancingEnabled}
          disabled={!settingsHydrated}
          onCheckedChange={(loadBalancingEnabled) => updateClientSettings({ loadBalancingEnabled })}
        />
      }
    >
      <SettingsRow
        title={gt("Routing strategy")}
        description={
          settings.loadBalancingStrategy === "usage" ? (
            gt(
              "Prefer remaining quota on confirmed subscription accounts. Recognized plan prices weight the remaining quota automatically; hardware breaks ties. API models use hardware.",
            )
          ) : (
            <T>
              New threads in shared projects start on the machine with the most free CPU and memory,
              weighted by each machine's preference.
            </T>
          )
        }
        control={
          <Select
            items={[
              { value: "hardware", label: gt("Hardware", { $context: "routing strategy" }) },
              { value: "usage", label: gt("Usage", { $context: "routing strategy" }) },
            ]}
            value={settings.loadBalancingStrategy}
            disabled={!settingsHydrated || !settings.loadBalancingEnabled}
            onValueChange={(value) => {
              if (value === "hardware" || value === "usage")
                updateClientSettings({ loadBalancingStrategy: value });
            }}
          >
            <SelectTrigger size="xs" className="w-36" aria-label={gt("Load balancing strategy")}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="hardware">
                {gt("Hardware", { $context: "routing strategy" })}
              </SelectItem>
              <SelectItem value="usage">{gt("Usage", { $context: "routing strategy" })}</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {environments.map((environment) => (
        <EnvironmentRow
          environmentId={environment.environmentId}
          key={environment.environmentId}
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          label={environment.label}
          subtitle={<EnvironmentTransportLabel environment={environment} />}
        >
          <Select
            items={items}
            value={loadPreferenceForWeight(
              settings.loadBalancingWeights[environment.environmentId],
            )}
            disabled={!settingsHydrated || !settings.loadBalancingEnabled}
            onValueChange={(value) => {
              if (value === null) return;
              updateClientSettings({
                loadBalancingWeights: {
                  ...settings.loadBalancingWeights,
                  [environment.environmentId]: value,
                },
              });
            }}
          >
            <SelectTrigger
              size="xs"
              className="w-36"
              aria-label={gt("{environment} load preference", { environment: environment.label })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {items.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}
