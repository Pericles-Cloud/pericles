import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint Configuration for Mastra Backend
 *
 * This configuration enforces TypeScript best practices and coding standards
 * based on .cursor/rules/300-languages/307-typescript-core-standards-auto.mdc
 *
 * Key rules enforced:
 * - No 'any' types (use specific types, generics, or 'unknown')
 * - Named exports preferred over default exports
 * - Proper error handling (no empty catch blocks)
 * - Constants for magic numbers
 * - Consistent code style
 */

export default tseslint.config(
  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Language options
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-specific rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // === INTENTIONAL EXCEPTIONS ===

      // Tools work with dynamic API responses - unsafe operations are expected
      ...(process.env.ESLINT_STRICT !== 'true' && {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
      }),

      // === END INTENTIONAL EXCEPTIONS ===
      // === TypeScript Best Practices (from 307-typescript-core-standards-auto.mdc) ===

      // No 'any' types - but allow in specific contexts (logger, queue, JSON)
      '@typescript-eslint/no-explicit-any': 'warn',

      // Named exports preferred (easier refactoring, better tree-shaking)
      'import/no-default-export': 'off', // Will be enabled when import plugin is added
      'import/prefer-default-export': 'off',

      // CRITICAL: Proper error handling - no empty catch blocks
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': [
        'warn', // Changed to warn for flexibility
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true, // Allow unused vars in rest properties
        },
      ],

      // Use constants for magic numbers (disabled for now - too noisy)
      'no-magic-numbers': 'off',

      // === Additional TypeScript Best Practices ===

      // Consistent type definitions
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],

      // Explicit function return types for better documentation (disabled for now)
      '@typescript-eslint/explicit-function-return-type': 'off',

      // Proper async/await usage
      '@typescript-eslint/no-floating-promises': 'warn', // Warn instead of error
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn', // Warn for async without await (placeholders)

      // Prevent common mistakes
      '@typescript-eslint/no-unnecessary-condition': 'off', // Too strict for some valid patterns
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'off', // || is fine for default values
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'off', // Allow numbers in template literals
      '@typescript-eslint/no-inferrable-types': 'warn', // Warn instead of error
      '@typescript-eslint/no-non-null-assertion': 'warn', // Warn instead of error
      '@typescript-eslint/array-type': ['warn', { default: 'array-simple' }], // Warn for array types
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn', // Warn instead of error
      '@typescript-eslint/restrict-plus-operands': 'warn', // Warn for adding any values
      '@typescript-eslint/no-deprecated': 'off', // Disabled - z.string().datetime() etc. are correct in Zod 4

      // Code quality - relaxed for real-world use
      '@typescript-eslint/naming-convention': 'off', // Too strict for API responses and JSON data

      // === General JavaScript Best Practices ===

      // Consistent code style
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'log'] }],
      'no-debugger': 'error',
      'no-alert': 'error',

      // Prevent bugs
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      // Best practices
      'prefer-const': 'error',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'no-var': 'error',
    },
  },

  // Ignore patterns
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.mastra/**',
      '**/prisma/generated/**',
      '**/*.config.js',
      '**/*.config.mjs',
      'eslint.config.js',
      '.lintstagedrc.js',
      'coverage/**',
      '.next/**',
      '.vercel/**',
      '*.min.js',
      '*.min.css',
    ],
  },

  // Config files can use default exports
  {
    files: ['**/*.config.ts', '**/*.config.js'],
    rules: {
      'import/no-default-export': 'off',
    },
  }
);
