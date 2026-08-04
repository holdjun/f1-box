import type { ValidateFunction } from "ajv";
import type { SeasonPayload } from "./season.generated.js";

declare const validate: ValidateFunction<SeasonPayload>;
export default validate;
