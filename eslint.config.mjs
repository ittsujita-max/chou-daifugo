import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // ルールエンジンは純粋関数のみ（CLAUDE.md「ルールエンジンの設計原則」）。
    // I/O・時刻・グローバル乱数に触れたらここで落ちる。
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: '乱数は引数で受け取るシード付きRNG（rng.ts）を使う',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'ルールエンジンは時刻に依存しない',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'ルールエンジンはI/Oを行わない' },
        { name: 'document', message: 'ルールエンジンはDOMに触れない' },
        { name: 'window', message: 'ルールエンジンはDOMに触れない' },
        { name: 'process', message: 'ルールエンジンは実行環境に依存しない' },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
