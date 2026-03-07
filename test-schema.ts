import { ErnOSSchema } from "./src/config/zod-schema.js";

try {
  ErnOSSchema.parse({ messages: { tts: { provider: "qwen" } } });
  console.log("Success!");
} catch (err) {
  console.log(JSON.stringify(err, null, 2));
}
