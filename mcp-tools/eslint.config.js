import js from '@eslint/js';
import tsEslint from 'typescript-eslint';

export default tsEslint.config(
  js.configs.recommended,
  ...tsEslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  }
);
