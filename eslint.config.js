import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const noJsxLiterals = {
  rules: {
    'no-jsx-literals': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { literal: 'Move user-visible JSX text to app/src/strings.ts.' },
      },
      create(context) {
        return {
          JSXText(node) {
            if (node.value.trim() !== '') context.report({ node, messageId: 'literal' });
          },
          JSXExpressionContainer(node) {
            if (node.expression.type === 'Literal' && typeof node.expression.value === 'string')
              context.report({ node, messageId: 'literal' });
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.wrangler/**',
      '.claude/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    ignores: ['app/src/strings.ts'],
    plugins: { 'ui-copy': noJsxLiterals },
    rules: { 'ui-copy/no-jsx-literals': 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['app/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
);
