import { resolveEnvironmentMachineKind, PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";

import {
  useClientSettings,
  useClientSettingsHydrated,
  updateClientSettings,
} from "~/hooks/useSettings";
import { useEnvironmentProviders, type EnvironmentPresentation } from "~/state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { loadBalancingAccountKey } from "@t3tools/client-runtime/load-balancing";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { EnvironmentRow, EnvironmentTransportLabel } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

const preferences = [
  { value: 100, label: "Prefer" },
  { value: 50, label: "Normal" },
  { value: 25, label: "Less often" },
  { value: 0, label: "Manual only" },
] as const;

type LoadPreference = (typeof preferences)[number]["value"];

function loadPreferenceForWeight(weight: number | undefined): LoadPreference {
  if (weight === undefined || weight === 50) return 50;
  if (weight === 0) return 0;
  return weight < 50 ? 25 : 100;
}

function preferenceLabel(preference: LoadPreference): string {
  return preferences.find((entry) => entry.value === preference)!.label;
}

function summarizeLoadPreferences(
  environments: ReadonlyArray<Pick<EnvironmentPresentation, "environmentId" | "label">>,
  weights: Readonly<Record<string, number>>,
): string | null {
  const parts = environments.flatMap((environment) => {
    const preference = loadPreferenceForWeight(weights[environment.environmentId]);
    return preference === 50
      ? []
      : [`${environment.label} ${preferenceLabel(preference).toLowerCase()}`];
  });
  return parts.length === 0 ? null : parts.join(" · ");
}

export function LoadBalancingSettings({
  environments,
}: {
  environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const settings = useClientSettings((current) => ({
    loadBalancingEnabled: current.loadBalancingEnabled,
    loadBalancingWeights: current.loadBalancingWeights,
    loadBalancingStrategy: current.loadBalancingStrategy,
    loadBalancingCapacities: current.loadBalancingCapacities,
  }));
  const settingsHydrated = useClientSettingsHydrated();
  const providersByEnvironment = useEnvironmentProviders();

  if (environments.length < 2) return null;

  const accounts = new Map(
    environments.flatMap((environment) =>
      (providersByEnvironment.get(environment.environmentId) ?? [])
        .filter((provider) => provider.installed && provider.auth.status !== "unauthenticated")
        .map(
          (provider) =>
            [
              loadBalancingAccountKey(environment.environmentId, provider),
              { provider, environment },
            ] as const,
        ),
    ),
  );
  const { id, title } = searchableSetting("load-balancing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        settings.loadBalancingEnabled
          ? [
              settings.loadBalancingStrategy === "usage" ? "Usage" : "Hardware",
              summarizeLoadPreferences(environments, settings.loadBalancingWeights),
            ]
              .filter(Boolean)
              .join(" · ")
          : "Off"
      }
      control={
        <Switch
          aria-label="Automatically balance load"
          checked={settings.loadBalancingEnabled}
          disabled={!settingsHydrated}
          onCheckedChange={(loadBalancingEnabled) => updateClientSettings({ loadBalancingEnabled })}
        />
      }
    >
      <SettingsRow
        title="Routing strategy"
        description={
          settings.loadBalancingStrategy === "usage"
            ? "Prefer remaining subscription quota, adjusted by capacity. Hardware breaks ties; unknown quotas fall back to hardware."
            : "Prefer available CPU and memory, weighted by each machine's preference. Only machines supporting the selected model are eligible."
        }
        control={
          <Select
            items={[
              { value: "hardware", label: "Hardware" },
              { value: "usage", label: "Usage" },
            ]}
            value={settings.loadBalancingStrategy}
            disabled={!settingsHydrated || !settings.loadBalancingEnabled}
            onValueChange={(value) => {
              if (value === "hardware" || value === "usage")
                updateClientSettings({ loadBalancingStrategy: value });
            }}
          >
            <SelectTrigger size="xs" className="w-36" aria-label="Load balancing strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="hardware">Hardware</SelectItem>
              <SelectItem value="usage">Usage</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {environments.map((environment) => (
        <EnvironmentRow
          key={environment.environmentId}
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          label={environment.label}
          subtitle={<EnvironmentTransportLabel environment={environment} />}
        >
          <Select
            items={preferences}
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
              aria-label={`${environment.label} load preference`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {preferences.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </EnvironmentRow>
      ))}
      {settings.loadBalancingStrategy === "usage" && (
        <>
          <SettingsRow
            title="Subscription capacity"
            description="Use 1 for a baseline plan, or 10 for ten times its quota. Shared accounts use one value; price alone does not determine capacity."
          />
          {[...accounts].map(([accountKey, { provider, environment }]) => {
            const capacity = settings.loadBalancingCapacities[accountKey] ?? 1;
            const label = provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver];
            return (
              <SettingsRow
                key={accountKey}
                title={label}
                description={provider.auth.email ?? environment.label}
                control={
                  <div className="w-36 shrink-0">
                    <Input
                      key={`${accountKey}:${capacity}`}
                      type="number"
                      size="compact"
                      min={0.01}
                      max={1000000}
                      step="any"
                      aria-label={`${label} ${provider.auth.email ?? environment.label} relative capacity`}
                      defaultValue={capacity}
                      disabled={!settingsHydrated || !settings.loadBalancingEnabled}
                      onBlur={(event) => {
                        const value = Number(event.currentTarget.value);
                        if (!Number.isFinite(value) || value < 0.01 || value > 1000000) {
                          event.currentTarget.value = String(capacity);
                          return;
                        }
                        updateClientSettings({
                          loadBalancingCapacities: {
                            ...settings.loadBalancingCapacities,
                            [accountKey]: value,
                          },
                        });
                      }}
                    />
                  </div>
                }
              />
            );
          })}
        </>
      )}
    </FoldedSettingsSection>
  );
}
