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
          ? summarizeLoadPreferences(environments, settings.loadBalancingWeights)
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
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        New threads can use any model available on the project's eligible machines. Choose how to
        rank machines that support the selected model.
      </p>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <span className="text-xs">Routing strategy</span>
        <Select
          items={[
            { value: "hardware", label: "Hardware" },
            { value: "usage", label: "Usage first" },
          ]}
          value={settings.loadBalancingStrategy}
          disabled={!settingsHydrated || !settings.loadBalancingEnabled}
          onValueChange={(value) => {
            if (value === "hardware" || value === "usage")
              updateClientSettings({ loadBalancingStrategy: value });
          }}
        >
          <SelectTrigger size="xs" className="w-32" aria-label="Load balancing strategy">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="hardware">Hardware</SelectItem>
            <SelectItem value="usage">Usage first</SelectItem>
          </SelectPopup>
        </Select>
      </div>
      <p className="px-3 pb-2.5 text-xs text-muted-foreground sm:px-4">
        {settings.loadBalancingStrategy === "usage"
          ? "Prefer the most remaining subscription quota, adjusted by capacity. Hardware breaks ties. Missing or incomparable quotas fall back to hardware. API cash balances are not subscription quotas."
          : "Prefer free CPU and memory, weighted by each machine's preference."}
      </p>
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
              className="w-32"
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
          <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
            Relative subscription capacity: use 1 for your baseline plan and 10 for a plan with ten
            times its quota. Price alone does not determine capacity. Shared accounts use one
            setting. Weekly quota takes priority over monthly or session quota; exhausted shorter
            limits still block routing.
          </p>
          {[...accounts].map(([accountKey, { provider, environment }]) => {
            const capacity = settings.loadBalancingCapacities[accountKey] ?? 1;
            const label = provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver];
            return (
              <div
                key={accountKey}
                className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4"
              >
                <div className="min-w-0 text-xs">
                  <div>{label}</div>
                  <div className="truncate text-muted-foreground">
                    {provider.auth.email ?? environment.label}
                  </div>
                </div>
                <div className="w-24 shrink-0">
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
              </div>
            );
          })}
        </>
      )}
    </FoldedSettingsSection>
  );
}
