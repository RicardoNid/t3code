import * as NodeSqlite from "node:sqlite";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const StoredKey = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ server: Schema.optionalKey(Schema.Unknown) })),
  ),
});
const decodeStoredKey = Schema.decodeOption(Schema.fromJsonString(StoredKey));

// Select before decoding so an OAuth or self-hosted connection cannot fall
// through to another stored account. NULL-active rows predate the selection flag.
class OpenCodeCredentialReadError extends Schema.TaggedError<OpenCodeCredentialReadError>()(
  "OpenCodeCredentialReadError",
  { databasePath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not read OpenCode credentials from ${this.databasePath}.`;
  }
}

export const readStoredApiKey = Effect.fn("OpenCode.readStoredApiKey")(
  (databasePath: string, integrationId: string, expectedServer = "https://opencode.ai/console") =>
    Effect.try({
      try: () => {
        const database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
        try {
          database.exec("PRAGMA busy_timeout = 100");
          const row = database
            .prepare(
              `SELECT value FROM credential
             WHERE integration_id = ? AND active IS NOT 0
             ORDER BY active DESC, time_created DESC, id DESC LIMIT 1`,
            )
            .get(integrationId);
          const stored =
            typeof row?.value === "string"
              ? Option.getOrUndefined(decodeStoredKey(row.value))
              : undefined;
          if (row !== undefined && !stored) return null;
          const server = stored?.metadata?.server;
          if (typeof server === "string") {
            const url = new URL(server);
            const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
            if (endpoint !== expectedServer && endpoint !== `${expectedServer}/v1`) return null;
          }
          return stored ? stored.key.trim() || null : undefined;
        } finally {
          database.close();
        }
      },
      catch: (cause) => new OpenCodeCredentialReadError({ databasePath, cause }),
    }).pipe(
      Effect.orElseSucceed((error) =>
        error.cause instanceof Error && error.cause.message.includes("no such table: credential")
          ? undefined
          : null,
      ),
    ),
);
