import type { ServerProviderApiBalance } from "@t3tools/contracts";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Hex from "effect/encoding/Hex";
import * as HttpClient from "effect/http/HttpClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { GlmQuota, glmUsageWindows } from "./glmUsage.ts";
import { readConfiguredApiProviders } from "./apiConfig.ts";
import { readStoredApiKey } from "./apiCredentials.ts";

const ApiAuth = Schema.Struct({ type: Schema.Literal("api"), key: Schema.String });
const decodeApiAuth = Schema.decodeUnknownOption(ApiAuth);
const decodeAuth = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const Amount = Schema.String.check(Schema.isPattern(/^-?\d+(?:\.\d+)?$/));
const DeepSeekBalance = Schema.Struct({
  is_available: Schema.Boolean,
  balance_infos: Schema.Array(
    Schema.Struct({ currency: Schema.Literals(["CNY", "USD"]), total_balance: Amount }),
  ).check(Schema.isMinLength(1)),
});
const KimiBalance = Schema.Struct({
  code: Schema.Literal(0),
  status: Schema.Literal(true),
  data: Schema.Struct({ available_balance: Schema.Finite }),
});

const vendors = [
  {
    id: "deepseek",
    vendor: "deepseek",
    origin: "https://api.deepseek.com",
    endpoint: "/user/balance",
  },
  {
    id: "moonshotai-cn",
    vendor: "kimi-cn",
    origin: "https://api.moonshot.cn",
    endpoint: "/v1/users/me/balance",
  },
  {
    id: "moonshotai",
    vendor: "kimi",
    origin: "https://api.moonshot.ai",
    endpoint: "/v1/users/me/balance",
  },
  {
    id: "kimi-for-coding",
    vendor: "kimi-coding",
    origin: "https://api.kimi.com/coding",
    endpoint: null,
  },
  {
    id: "zhipuai-coding-plan",
    vendor: "glm",
    origin: "https://open.bigmodel.cn",
    endpoint: "/api/monitor/usage/quota/limit",
  },
  { id: "zhipuai", vendor: "glm", origin: "https://open.bigmodel.cn", endpoint: null },
  { id: "zai", vendor: "glm", origin: "https://api.z.ai", endpoint: null },
  {
    id: "zai-coding-plan",
    vendor: "glm",
    origin: "https://api.z.ai",
    endpoint: "/api/monitor/usage/quota/limit",
  },
  { id: "xiaomi", vendor: "mimo", origin: "https://api.xiaomimimo.com", endpoint: null },
  { id: "alibaba", vendor: "qwen", origin: "https://dashscope-intl.aliyuncs.com", endpoint: null },
  { id: "alibaba-cn", vendor: "qwen", origin: "https://dashscope.aliyuncs.com", endpoint: null },
  {
    id: "tencent",
    vendor: "hunyuan",
    origin: "https://api.hunyuan.cloud.tencent.com",
    endpoint: null,
  },
  { id: "minimax", vendor: "minimax", origin: "https://api.minimax.io", endpoint: null },
  { id: "minimax-cn", vendor: "minimax", origin: "https://api.minimaxi.com", endpoint: null },
] as const;

// Only documented, fixed vendor endpoints receive a credential; never follow a configured gateway.
export const readOpenCodeApiBalances = Effect.fn("OpenCode.readApiBalances")(function* (input: {
  readonly enabled: boolean;
  readonly serverUrl: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  if (!input.enabled || input.serverUrl.trim()) return [];
  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const digest = yield* Digest.Digest;
    const env = input.environment;
    const home =
      env.XDG_DATA_HOME ||
      path.join(
        env.HOME || env.USERPROFILE || (yield* HostProcess.HomeDirectory),
        ".local",
        "share",
      );
    const contents =
      env.OPENCODE_AUTH_CONTENT ||
      (yield* fs.readFileString(path.join(home, "opencode", "auth.json")).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.fail(error),
        }),
      ));
    const auth = yield* decodeAuth(contents);
    const db = env.OPENCODE_DB ?? "opencode.db";
    const databasePath = path.resolve(home, "opencode", db);
    const hasDatabase =
      !env.OPENCODE_AUTH_CONTENT && db !== ":memory:" && (yield* fs.exists(databasePath));
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const credentials: {
      vendor: (typeof vendors)[number];
      key: string;
      fingerprint: string;
      quotaHeaders?: { organization: string | null; project: string | null } | undefined;
    }[] = [];
    const seen = new Set<string>();
    const configured = yield* readConfiguredApiProviders(env);
    const matchesEndpoint = (baseURL: string | null, vendor: (typeof vendors)[number]) =>
      baseURL !== null &&
      [
        vendor.origin,
        `${vendor.origin}/v1`,
        ...(vendor.id.includes("coding-plan") ? [`${vendor.origin}/api/coding/paas/v4`] : []),
      ].includes(baseURL.replace(/\/+$/, ""));
    const sources = [
      ...vendors.map((vendor) => ({
        vendor,
        id: vendor.id as string,
        config: configured.get(vendor.id),
      })),
      ...[...configured].flatMap(([id, config]) => {
        if (vendors.some((vendor) => vendor.id === id)) return [];
        const vendor = vendors.find(
          (vendor) => config.baseURL !== undefined && matchesEndpoint(config.baseURL, vendor),
        );
        return vendor ? [{ vendor, id, config }] : [];
      }),
    ];
    for (const { vendor, id, config } of sources) {
      if (config?.baseURL !== undefined && !matchesEndpoint(config.baseURL, vendor)) continue;
      const inline = decodeApiAuth(auth[id]);
      const stored =
        config?.apiKey !== undefined || !hasDatabase
          ? undefined
          : yield* readStoredApiKey(databasePath, id, vendor.origin);
      // An explicit config key overrides stored authentication; an empty reference must not fall back.
      const key = (
        config?.apiKey !== undefined
          ? config.apiKey
          : stored === undefined
            ? Option.isSome(inline)
              ? inline.value.key
              : undefined
            : stored
      )?.trim();
      if (!key) continue;
      const fingerprint = yield* digest
        .digest(
          Digest.sha256,
          new TextEncoder().encode(
            `api-balance:${vendor.vendor}\0${key}${vendor.vendor === "glm" && config?.quotaHeaders ? `\0${config.quotaHeaders.organization ?? ""}\0${config.quotaHeaders.project ?? ""}` : ""}`,
          ),
        )
        .pipe(Effect.map(Hex.encode), Effect.orDie);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      credentials.push({ vendor, key, fingerprint, quotaHeaders: config?.quotaHeaders });
    }
    return yield* Effect.forEach(
      credentials,
      ({ vendor, key, fingerprint, quotaHeaders }) => {
        const base: ServerProviderApiBalance = {
          vendor: vendor.vendor,
          credentialFingerprint: fingerprint,
          checkedAt,
          balances: [],
          ...(vendor.id.includes("coding-plan") ? { accountType: "subscription" as const } : {}),
        };
        if (vendor.endpoint === null)
          return Effect.succeed<ServerProviderApiBalance>({ ...base, unavailable: "unsupported" });
        return Effect.gen(function* () {
          const client = yield* HttpClient.HttpClient;
          const team =
            vendor.vendor === "glm" && quotaHeaders?.organization && quotaHeaders.project;
          let request = HttpClientRequest.get(
            `${vendor.origin}${vendor.endpoint}${team ? "?type=2" : ""}`,
          ).pipe(HttpClientRequest.bearerToken(key));
          if (team)
            request = request.pipe(
              HttpClientRequest.setHeaders({
                "Bigmodel-Organization": quotaHeaders.organization!,
                "Bigmodel-Project": quotaHeaders.project!,
              }),
            );
          const response = yield* client.execute(request);
          yield* HttpClientResponse.filterStatusOk(response);
          if (vendor.vendor === "glm") {
            const result = yield* HttpClientResponse.schemaBodyJson(GlmQuota)(response);
            const windows = glmUsageWindows(result);
            if (windows.length === 0) return { ...base, unavailable: "probeFailed" as const };
            return { ...base, windows };
          }
          if (vendor.vendor === "deepseek") {
            const result = yield* HttpClientResponse.schemaBodyJson(DeepSeekBalance)(response);
            return {
              ...base,
              balances: result.balance_infos.map((balance) => ({
                currency: balance.currency,
                total: balance.total_balance,
              })),
            };
          }
          const result = yield* HttpClientResponse.schemaBodyJson(KimiBalance)(response);
          return {
            ...base,
            balances: [
              {
                currency: vendor.vendor === "kimi-cn" ? "CNY" : "USD",
                total: String(result.data.available_balance),
              },
            ],
          };
        }).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.timeout("5 seconds"),
          Effect.orElseSucceed(() => ({ ...base, unavailable: "probeFailed" as const })),
        );
      },
      { concurrency: 3 },
    );
  }).pipe(Effect.orElseSucceed(() => []));
});
