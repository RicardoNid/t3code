import * as NodeAssert from "node:assert/strict";
import * as NodeSqlite from "node:sqlite";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { readOpenCodeApiBalances } from "./apiBalances.ts";
import { readOpenCodeUsageLimits } from "./usageLimits.ts";

const input = (auth: Record<string, unknown>) => ({
  enabled: true,
  serverUrl: "",
  environment: {
    HOME: "/nonexistent-opencode-test-home",
    XDG_CONFIG_HOME: "/nonexistent-opencode-test-config",
    OPENCODE_AUTH_CONTENT: JSON.stringify(auth),
  },
});
const key = { type: "api", key: "sk-fake-only-for-test" };
const services = Layer.mergeAll(
  NodeServices.layer,
  NodeCrypto.layer,
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("Unexpected HTTP request")),
  ),
);

it.effect.each([
  {
    id: "deepseek",
    url: "https://api.deepseek.com/user/balance",
    currency: "CNY",
    amount: "19.1234567890123456789",
    body: {
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: "19.1234567890123456789" }],
    },
  },
  {
    id: "moonshotai-cn",
    url: "https://api.moonshot.cn/v1/users/me/balance",
    currency: "CNY",
    amount: "5.12345",
    body: { code: 0, status: true, data: { available_balance: 5.12345 } },
  },
  {
    id: "moonshotai",
    url: "https://api.moonshot.ai/v1/users/me/balance",
    currency: "USD",
    amount: "-0.01",
    body: { code: 0, status: true, data: { available_balance: -0.01 } },
  },
])("reads $id at its official endpoint without returning the key", (scenario) =>
  Effect.gen(function* () {
    const balances = yield* readOpenCodeApiBalances(input({ [scenario.id]: key })).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          NodeAssert.equal(request.url, scenario.url);
          NodeAssert.equal(request.headers.authorization, `Bearer ${key.key}`);
          return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(scenario.body)));
        }),
      ),
    );
    NodeAssert.deepEqual(balances[0]?.balances, [
      { currency: scenario.currency, total: scenario.amount },
    ]);
    NodeAssert.match(balances[0]?.credentialFingerprint ?? "", /^[a-f0-9]{64}$/);
    NodeAssert.ok(!JSON.stringify(balances).includes(key.key));
    const otherDevice = input({ [scenario.id]: key });
    const again = yield* readOpenCodeApiBalances({
      ...otherDevice,
      environment: { ...otherDevice.environment, XDG_DATA_HOME: "/another-device" },
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(scenario.body))),
        ),
      ),
    );
    NodeAssert.equal(again[0]?.credentialFingerprint, balances[0]?.credentialFingerprint);
  }).pipe(Effect.provide(services)),
);

it.effect.each([
  { status: 401, body: { error: key.key } },
  { status: 429, body: { error: "rate limited" } },
  { status: 302, body: { error: "redirect" } },
  { status: 200, body: { is_available: false, balance_infos: [] } },
  {
    status: 200,
    body: { is_available: true, balance_infos: [{ currency: "CNY", total_balance: key.key }] },
  },
])("reports a failed $status probe as unavailable, never zero or a secret", (scenario) =>
  Effect.gen(function* () {
    const balances = yield* readOpenCodeApiBalances(input({ deepseek: key })).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(scenario.body, { status: scenario.status }),
            ),
          ),
        ),
      ),
    );
    NodeAssert.equal(balances[0]?.unavailable, "probeFailed");
    NodeAssert.deepEqual(balances[0]?.balances, []);
    NodeAssert.ok(!JSON.stringify(balances).includes(key.key));
  }).pipe(Effect.provide(services)),
);

it.effect("deduplicates aliases and reports unverified vendors without making requests", () =>
  Effect.gen(function* () {
    const balances = yield* readOpenCodeApiBalances(
      input({ zhipuai: key, zai: key, xiaomi: key, alibaba: key, tencent: key, minimax: key }),
    );
    NodeAssert.equal(balances.length, 5);
    NodeAssert.ok(balances.every((balance) => balance.unavailable === "unsupported"));
  }).pipe(Effect.provide(services)),
);

it.effect("does not read host credentials for a remote or disabled OpenCode", () =>
  Effect.gen(function* () {
    for (const settings of [
      { enabled: false, serverUrl: "" },
      { enabled: true, serverUrl: "https://remote.test" },
    ]) {
      NodeAssert.deepEqual(
        yield* readOpenCodeApiBalances({ ...input({ deepseek: key }), ...settings }),
        [],
      );
    }
  }).pipe(Effect.provide(services)),
);

it.effect("cancels an unresponsive balance request at its deadline", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();
    const pending = yield* readOpenCodeApiBalances(input({ deepseek: key })).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
          ),
        ),
      ),
      Effect.forkChild,
    );
    yield* Deferred.await(started);
    yield* TestClock.adjust("5 seconds");
    NodeAssert.equal((yield* Fiber.join(pending))[0]?.unavailable, "probeFailed");
    yield* Deferred.await(stopped);
  }).pipe(Effect.provide(services)),
);

it.effect.each([
  { value: { type: "key", key: "v2-key" }, expected: "Bearer v2-key" },
  {
    value: { type: "key", key: "v2-key", metadata: { server: "https://api.deepseek.com/v1" } },
    expected: "Bearer v2-key",
  },
  {
    value: { type: "key", key: "custom-key", metadata: { server: "https://custom.test" } },
    expected: null,
  },
  { value: { type: "oauth", access: "oauth-access" }, expected: null },
])("uses selected v2 credentials without falling back to old keys: $expected", (scenario) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(`${home}/opencode`);
    yield* fs.writeFileString(`${home}/opencode/auth.json`, JSON.stringify({ deepseek: key }));
    const file = `${home}/opencode/selected.db`;
    const db = new NodeSqlite.DatabaseSync(file);
    db.exec(
      "CREATE TABLE credential (id TEXT, integration_id TEXT, value TEXT, active INTEGER, time_created INTEGER)",
    );
    db.prepare("INSERT INTO credential VALUES (?, ?, ?, ?, ?)").run(
      "selected",
      "deepseek",
      JSON.stringify(scenario.value),
      1,
      2,
    );
    db.prepare("INSERT INTO credential VALUES (?, ?, ?, ?, ?)").run(
      "inactive",
      "deepseek",
      JSON.stringify({ type: "key", key: "inactive-key" }),
      0,
      3,
    );
    db.close();
    const before = yield* fs.readFile(file);
    const balances = yield* readOpenCodeApiBalances({
      enabled: true,
      serverUrl: "",
      environment: {
        HOME: home,
        XDG_CONFIG_HOME: `${home}/config`,
        XDG_DATA_HOME: home,
        OPENCODE_DB: "selected.db",
      },
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          NodeAssert.equal(request.headers.authorization, scenario.expected);
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({
                is_available: true,
                balance_infos: [{ currency: "USD", total_balance: "2.00" }],
              }),
            ),
          );
        }),
      ),
    );
    NodeAssert.equal(balances.length, scenario.expected === null ? 0 : 1);
    NodeAssert.deepEqual(yield* fs.readFile(file), before);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("keeps subscription limits and API balances in the same provider snapshot", () =>
  Effect.gen(function* () {
    const result = yield* readOpenCodeUsageLimits(
      input({ deepseek: key, "opencode-go": { type: "api", key: "go-key" } }),
    ).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(
                request.url.includes("deepseek")
                  ? {
                      is_available: true,
                      balance_infos: [{ currency: "CNY", total_balance: "0.00" }],
                    }
                  : {
                      usage: Object.fromEntries(
                        ["rolling", "weekly", "monthly"].map((name) => [
                          name,
                          { percent: 10, resetsAt: "2026-11-08T00:00:00.000Z" },
                        ]),
                      ),
                    },
              ),
            ),
          ),
        ),
      ),
    );
    NodeAssert.equal(result.windows.length, 3);
    NodeAssert.equal(result.apiBalances?.[0]?.balances[0]?.total, "0.00");
    NodeAssert.ok(!JSON.stringify(result).includes(key.key));
  }).pipe(Effect.provide(services)),
);

it.effect("does not use a legacy key when the selected credential database is unreadable", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(`${home}/opencode`);
    yield* fs.writeFileString(`${home}/opencode/auth.json`, JSON.stringify({ deepseek: key }));
    yield* fs.writeFileString(`${home}/opencode/opencode.db`, "corrupt database");
    const balances = yield* readOpenCodeApiBalances({
      enabled: true,
      serverUrl: "",
      environment: { HOME: home, XDG_CONFIG_HOME: `${home}/config`, XDG_DATA_HOME: home },
    });
    NodeAssert.deepEqual(balances, []);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect(
  "reads configured SDK keys and custom Moonshot file references without querying gateways",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${home}/config/opencode`, { recursive: true });
      yield* fs.writeFileString(`${home}/kimi-key`, "fake-kimi-config-key\n");
      yield* fs.writeFileString(
        `${home}/config/opencode/opencode.jsonc`,
        `{
      // The global config may contain credentials rather than auth.json.
      "provider": {
        "deepseek": { "npm": "@ai-sdk/deepseek", "options": { "apiKey": "{env:DEEPSEEK_API_KEY}" } },
        "moonshot": { "npm": "@ai-sdk/openai-compatible", "options": {
          "baseURL": "https://api.moonshot.cn/v1", "apiKey": "{file:../../kimi-key}",
        } },
        "moonshotai-cn": { "options": { "apiKey": "{file:~/kimi-key}" } },
        "gateway": { "options": { "baseURL": "https://gateway.test/v1", "apiKey": "gateway-key" } },
      },
    }`,
      );
      const requests: string[] = [];
      const balances = yield* readOpenCodeApiBalances({
        enabled: true,
        serverUrl: "",
        environment: {
          HOME: home,
          XDG_CONFIG_HOME: `${home}/config`,
          XDG_DATA_HOME: `${home}/data`,
          DEEPSEEK_API_KEY: "fake-deepseek-config-key",
        },
      }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push(request.url);
            NodeAssert.equal(
              request.headers.authorization,
              request.url.includes("deepseek")
                ? "Bearer fake-deepseek-config-key"
                : "Bearer fake-kimi-config-key",
            );
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json(
                  request.url.includes("deepseek")
                    ? {
                        is_available: true,
                        balance_infos: [{ currency: "CNY", total_balance: "1.25" }],
                      }
                    : { code: 0, status: true, data: { available_balance: 2.5 } },
                ),
              ),
            );
          }),
        ),
      );
      NodeAssert.deepEqual(requests.sort(), [
        "https://api.deepseek.com/user/balance",
        "https://api.moonshot.cn/v1/users/me/balance",
      ]);
      NodeAssert.deepEqual(balances.map((balance) => balance.vendor).sort(), [
        "deepseek",
        "kimi-cn",
      ]);
      NodeAssert.ok(!JSON.stringify(balances).includes("config-key"));
      yield* fs.makeDirectory(`${home}/data/opencode`, { recursive: true });
      yield* fs.writeFileString(
        `${home}/data/opencode/auth.json`,
        JSON.stringify({ deepseek: key }),
      );
      for (const options of [
        { baseURL: "https://gateway.test/v1", apiKey: "gateway-key" },
        { apiKey: "{file:missing-key}" },
      ]) {
        NodeAssert.deepEqual(
          yield* readOpenCodeApiBalances({
            enabled: true,
            serverUrl: "",
            environment: {
              HOME: home,
              XDG_CONFIG_HOME: `${home}/config`,
              XDG_DATA_HOME: `${home}/data`,
              OPENCODE_CONFIG_CONTENT: JSON.stringify({
                providers: {
                  deepseek: { settings: options },
                  moonshot: { settings: { apiKey: "{env:MISSING_KEY}" } },
                  "moonshotai-cn": { settings: { apiKey: "{env:MISSING_KEY}" } },
                },
              }),
            },
          }),
          [],
        );
      }
      yield* fs.writeFileString(
        `${home}/config/opencode/opencode.jsonc`,
        '{"provider": "malformed-secret-config-key"}',
      );
      NodeAssert.deepEqual(
        yield* readOpenCodeApiBalances({
          enabled: true,
          serverUrl: "",
          environment: {
            HOME: home,
            XDG_CONFIG_HOME: `${home}/config`,
            XDG_DATA_HOME: `${home}/data`,
          },
        }),
        [],
      );
    }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect(
  "reads separate GLM coding accounts, validates business success and never exposes keys",
  () =>
    Effect.gen(function* () {
      const result = yield* readOpenCodeApiBalances({
        ...input({ "zhipuai-coding-plan": key }),
        environment: {
          ...input({ "zhipuai-coding-plan": key }).environment,
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            provider: {
              team: {
                options: {
                  baseURL: "https://open.bigmodel.cn/api/coding/paas/v4",
                  apiKey: "another-fake-glm-key",
                  headers: {
                    "Bigmodel-Organization": "org-test",
                    "Bigmodel-Project": "project-test",
                  },
                },
              },
            },
          }),
        },
      }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            const team = request.headers["bigmodel-organization"] === "org-test";
            NodeAssert.equal(
              request.url,
              `https://open.bigmodel.cn/api/monitor/usage/quota/limit${team ? "?type=2" : ""}`,
            );
            if (team) NodeAssert.equal(request.headers["bigmodel-project"], "project-test");
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({
                  code: 200,
                  success: true,
                  data: {
                    limits: [
                      {
                        type: "CREDIT_LIMIT",
                        unit: 3,
                        number: 5,
                        percentage: 25,
                        nextResetTime: 1795300000000,
                      },
                      { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 60 },
                    ],
                  },
                }),
              ),
            );
          }),
        ),
      );
      NodeAssert.equal(result.length, 2);
      NodeAssert.notEqual(result[0]?.credentialFingerprint, result[1]?.credentialFingerprint);
      NodeAssert.deepEqual(
        result[0]?.windows?.map((w) => [w.kind, w.usedPercent, w.windowDurationMins]),
        [
          ["session", 25, 300],
          ["weekly", 60, 10080],
        ],
      );
      NodeAssert.ok(!JSON.stringify(result).includes(key.key));
      const failed = yield* readOpenCodeApiBalances(input({ "zhipuai-coding-plan": key })).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ code: 500, success: false, data: { limits: [] } }),
              ),
            ),
          ),
        ),
      );
      NodeAssert.equal(failed[0]?.unavailable, "probeFailed");
      NodeAssert.equal(failed[0]?.windows, undefined);
    }).pipe(Effect.provide(services)),
);
