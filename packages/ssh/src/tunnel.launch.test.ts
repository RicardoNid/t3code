import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { buildRemoteLaunchScript } from "./tunnel.ts";

it.live.each([
  { desktopOnly: true, existing: false, managed: false, previous: false, expected: "refused" },
  { desktopOnly: true, existing: true, managed: false, previous: false, expected: "external" },
  { desktopOnly: true, existing: true, managed: true, previous: false, expected: "external" },
  { desktopOnly: true, existing: true, managed: true, previous: true, expected: "external" },
  { desktopOnly: false, existing: false, managed: false, previous: false, expected: "managed" },
])("desktop-only=$desktopOnly existing=$existing managed=$managed previous=$previous", (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = yield* HostProcess.Environment;
    const platform = yield* HostProcess.Platform;
    const executable = yield* HostProcess.ExecutablePath;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-launch-" });
    const server = yield* spawner.spawn(
      ChildProcess.make(executable, ["-e", "process.stdin.resume()"], {
        stdin: { stream: Stream.never, endOnDone: false },
      }),
    );
    const previous = input.previous
      ? yield* spawner.spawn(
          ChildProcess.make(executable, ["-e", "process.stdin.resume()"], {
            stdin: { stream: Stream.never, endOnDone: false },
          }),
        )
      : server;
    const bin = path.join(home, "bin");
    const launch = path.join(home, ".t3", "ssh-launch");
    yield* fs.makeDirectory(bin);
    yield* fs.makeDirectory(launch, { recursive: true });
    if (input.managed) {
      const managed = path.join(launch, "fixture");
      yield* fs.makeDirectory(managed);
      yield* fs.writeFileString(path.join(managed, "pid"), String(previous.pid));
      yield* fs.writeFileString(path.join(managed, "port"), "3773");
      yield* fs.writeFileString(path.join(managed, "managed"), "managed");
    }
    if (input.desktopOnly) yield* fs.writeFileString(path.join(launch, "desktop-only"), "");
    const node = path.join(bin, "node");
    yield* fs.writeFileString(
      node,
      `#!/bin/sh
if [ "$1" = "-" ]; then
  case "$2" in
    */server-runtime.json)
      [ "$T3_TEST_EXISTING" = "yes" ] || exit 1
      printf '%s 3773' "$T3_TEST_PID" ;;
    */port) printf '3773' ;;
  esac
fi
exit 0
`,
    );
    yield* fs.chmod(node, 0o700);
    const child = yield* spawner.spawn(
      ChildProcess.make("sh", ["-s", "--", "fixture"], {
        stdin: {
          stream: Stream.make(
            new TextEncoder().encode(
              buildRemoteLaunchScript({ nodeScriptPath: "/fixture/server.mjs" }),
            ),
          ),
          endOnDone: true,
        },
        env: {
          ...environment,
          HOME: home,
          PATH: `${bin}${platform === "win32" ? ";" : ":"}${environment.PATH}`,
          T3_TEST_EXISTING: input.existing ? "yes" : "no",
          T3_TEST_PID: String(server.pid),
        },
      }),
    );
    const [code, stdout, stderr] = yield* Effect.all(
      [
        child.exitCode,
        child.stdout.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (text, chunk) => text + chunk,
          ),
        ),
        child.stderr.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (text, chunk) => text + chunk,
          ),
        ),
      ],
      { concurrency: "unbounded" },
    );
    if (input.expected === "refused") {
      assert.equal(code, 1);
      assert.include(stderr, "desktop-only");
      assert.isFalse(yield* fs.exists(path.join(launch, "fixture", "pid")));
    } else {
      assert.equal(code, 0, stderr);
      assert.equal(JSON.parse(stdout).serverKind, input.expected);
    }
    if (input.managed) assert.isTrue(yield* previous.isRunning);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
