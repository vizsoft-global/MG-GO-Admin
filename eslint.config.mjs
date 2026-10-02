import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/server",
              message:
                "Use @/lib/supabase/client in Client Components only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/app/**/route.ts",
      "src/app/**/page.tsx",
      "src/features/**/actions.ts",
      "src/features/**/*-actions.ts",
      "src/lib/auth/**",
      "src/lib/branding/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // A `.cjs` file is CommonJS by definition: it cannot use `import`, so the
    // rule that forbids `require()` has nothing to offer here. `scripts/` holds
    // Node-side tooling that never enters the app bundle.
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
