import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "@/core/constants";
import { parseReplay } from "@/replay/format";
import { gzip, readText } from "@/replay/gzip";
import { runReplay } from "@/replay/headless";
import { sims } from "@/scenes/sims";

// Every replay in fixtures/ is a regression test: it runs headless and must match every
// checkpoint. After an intentional behaviour change, `pnpm replay:update` (REPLAY_UPDATE=1)
// rewrites the checkpoints instead, keeping the recorded input.

const DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));
const UPDATE = process.env.REPLAY_UPDATE === "1";
const names = existsSync(DIR)
  ? readdirSync(DIR).filter((name) => /\.replay\.json(\.gz)?$/.test(name))
  : [];

describe("replay fixtures", () => {
  if (!names.length) it.skip("no replay fixtures yet", () => {});

  for (const name of names) {
    it(name, async () => {
      const path = DIR + name;
      const file = parseReplay(JSON.parse(await readText(readFileSync(path))), TICK_HZ);

      if (UPDATE) {
        const { checksums } = runReplay(file, sims, { rewrite: true });
        if (JSON.stringify(checksums) === JSON.stringify(file.checksums)) return;
        const text = JSON.stringify({ ...file, checksums });
        writeFileSync(path, name.endsWith(".gz") ? await gzip(text) : text);
        console.info(`replay:update rewrote the checkpoints of ${name}`);
        return;
      }

      const { divergence } = runReplay(file, sims);
      const hint = divergence
        ? `${name} diverged at tick ${divergence.tick} in ${divergence.diff.join(", ")}. ` +
          "If the change is intended, run `pnpm replay:update`."
        : "";
      expect(divergence, hint).toBeNull();
    });
  }
});
