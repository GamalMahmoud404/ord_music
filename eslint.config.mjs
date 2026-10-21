import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  // Node.js CommonJS helper scripts are not part of the Next.js app bundle.
  { ignores: ["scripts/**/*.cjs", "next-env.d.ts", ".next/**", "out/**", "node_modules/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];

export default eslintConfig;
