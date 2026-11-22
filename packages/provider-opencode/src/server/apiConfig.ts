import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const Options = Schema.Record(Schema.String, Schema.Unknown);
const Providers = Schema.Record(
  Schema.String,
  Schema.Struct({
    options: Schema.optionalKey(Options),
    settings: Schema.optionalKey(Options),
  }),
);
const decodeConfig = Schema.decodeEffect(
  fromLenientJson(
    Schema.Struct({
      provider: Schema.optionalKey(Providers),
      providers: Schema.optionalKey(Providers),
    }),
  ),
);

class OpenCodeApiConfigReadError extends Schema.TaggedError<OpenCodeApiConfigReadError>()(
  "OpenCodeApiConfigReadError",
  {},
) {
  override get message(): string {
    return "Could not parse OpenCode API configuration.";
  }
}

export const readConfiguredApiProviders = Effect.fn("OpenCode.readConfiguredApiProviders")(
  function* (env: NodeJS.ProcessEnv) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = env.HOME || env.USERPROFILE || (yield* HostProcess.HomeDirectory);
    const globalDirectory = path.join(
      env.XDG_CONFIG_HOME || path.join(home, ".config"),
      "opencode",
    );
    const providers = new Map<
      string,
      {
        readonly apiKey?: string | null;
        readonly baseURL?: string | null;
        readonly quotaHeaders?: { organization: string | null; project: string | null };
      }
    >();
    const resolveValue = Effect.fn("OpenCode.resolveConfigCredentialValue")(function* (
      value: unknown,
      directory: string,
    ) {
      if (typeof value !== "string") return null;
      let resolved = value;
      for (const match of value.matchAll(/\{(env|file):([^}]+)\}/g)) {
        const reference = match[2]!;
        const replacement =
          match[1] === "env"
            ? (env[reference] ?? "")
            : yield* fs
                .readFileString(
                  path.resolve(
                    directory,
                    reference.startsWith("~/") ? path.join(home, reference.slice(2)) : reference,
                  ),
                )
                .pipe(Effect.orElseSucceed(() => ""));
        resolved = resolved.replace(match[0], replacement.trim());
      }
      return resolved.trim() || null;
    });
    const merge = Effect.fn("OpenCode.mergeApiConfig")(function* (
      contents: string,
      directory: string,
    ) {
      const config = yield* decodeConfig(contents).pipe(
        Effect.mapError(() => new OpenCodeApiConfigReadError({})),
      );
      for (const [id, provider] of Object.entries({ ...config.provider, ...config.providers })) {
        const options = { ...provider.options, ...provider.settings };
        const previous = providers.get(id);
        providers.set(id, {
          ...previous,
          ...(Object.hasOwn(options, "apiKey")
            ? { apiKey: yield* resolveValue(options.apiKey, directory) }
            : {}),
          ...(Object.hasOwn(options, "headers")
            ? {
                quotaHeaders: {
                  organization: yield* resolveValue(
                    (options.headers as Record<string, unknown> | null)?.["Bigmodel-Organization"],
                    directory,
                  ),
                  project: yield* resolveValue(
                    (options.headers as Record<string, unknown> | null)?.["Bigmodel-Project"],
                    directory,
                  ),
                },
              }
            : {}),
          ...(Object.hasOwn(options, "baseURL")
            ? { baseURL: yield* resolveValue(options.baseURL, directory) }
            : {}),
        });
      }
    });
    const read = Effect.fn("OpenCode.readApiConfigFile")(function* (file: string) {
      const contents = yield* fs.readFileString(file).pipe(
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.fail(error),
        }),
      );
      yield* merge(contents, path.dirname(file));
    });
    for (const name of ["opencode.json", "opencode.jsonc"])
      yield* read(path.join(globalDirectory, name));
    if (env.OPENCODE_CONFIG) yield* read(path.resolve(env.OPENCODE_CONFIG));
    if (env.OPENCODE_CONFIG_DIR)
      for (const name of ["opencode.json", "opencode.jsonc"])
        yield* read(path.join(env.OPENCODE_CONFIG_DIR, name));
    if (env.OPENCODE_CONFIG_CONTENT) yield* merge(env.OPENCODE_CONFIG_CONTENT, path.resolve("."));
    return providers;
  },
);
