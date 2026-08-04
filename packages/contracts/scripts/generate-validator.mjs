import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(
  readFileSync(resolve(packageRoot, "season.schema.json"), "utf8"),
);
const ajv = new Ajv2020({
  allErrors: true,
  code: { esm: true, source: true },
});
addFormats(ajv);
const validate = ajv.compile(schema);
const code = standaloneCode(ajv, validate)
  .replace(
    /const (formats\d+) = require\("ajv-formats\/dist\/formats"\)\.fullFormats\["date-time"\];/,
    (_, name) =>
      `const ${name} = { validate(value) { const time = Date.parse(value); return Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === value; } };`,
  )
  .replace(
    /const (formats\d+) = require\("ajv-formats\/dist\/formats"\)\.fullFormats\.uri;/,
    (_, name) =>
      `const ${name} = (value) => { try { const url = new URL(value); return Boolean(url.protocol); } catch { return false; } };`,
  );

writeFileSync(
  resolve(packageRoot, "src/season.validator.generated.js"),
  `${code}\n`,
);
writeFileSync(
  resolve(packageRoot, "src/season.validator.generated.d.ts"),
  [
    'import type { ValidateFunction } from "ajv";',
    'import type { SeasonPayload } from "./season.generated.js";',
    "",
    "declare const validate: ValidateFunction<SeasonPayload>;",
    "export default validate;",
    "",
  ].join("\n"),
);
