import { plugin as shadcn } from '@shadcn/lint';
import tsParser from '@typescript-eslint/parser';

export default [{
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { shadcn },
  rules: {
    'shadcn/no-raw-colors': 'error',
    'shadcn/no-arbitrary-values': 'error',
    'shadcn/require-static-classes': 'error',
  },
}];
