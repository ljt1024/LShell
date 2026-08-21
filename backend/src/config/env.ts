import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(runtimeDir, "../..");
const projectRoot = path.resolve(runtimeDir, "../../..");

dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(backendRoot, ".env"), override: true });
