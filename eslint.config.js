import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  {
    ignores: ['dist/**', 'src-tauri/**', 'node_modules/**', 'build/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Allow exporting CVA variants alongside components (shadcn/ui pattern)
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/components/CollapsibleToolResult.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
