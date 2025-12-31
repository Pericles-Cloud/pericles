/**
 * Lint-Staged Configuration for Mastra Backend
 *
 * This configuration ensures code quality on pre-commit by running linters
 * and formatters only on staged files, following best practices from:
 * .cursor/rules/200-quality/204-lint-staged-core-standards-auto.mdc
 *
 * Key features:
 * - File-type specific commands
 * - Performance optimization through chunking
 * - TypeScript type checking
 * - Automated formatting and linting
 */

export default {
  // TypeScript and JavaScript files
  '*.{ts,tsx,js,jsx}': (files) => {
    const commands = [];

    // ESLint with auto-fix
    commands.push(`eslint --fix ${files.join(' ')}`);

    // Prettier formatting
    commands.push(`prettier --write ${files.join(' ')}`);

    return commands;
  },

  // TypeScript files - additional type checking
  '*.{ts,tsx}': (files) => {
    // Type check only TypeScript files
    return ['tsc --noEmit --pretty'];
  },

  // JSON files
  '*.json': (files) => {
    return [`prettier --write ${files.join(' ')}`];
  },

  // Markdown files
  '*.md': (files) => {
    return [`prettier --write ${files.join(' ')}`];
  },

  // Prisma schema files
  '*.prisma': (files) => {
    return [`prettier --write ${files.join(' ')}`, 'npx prisma validate'];
  },

  // Package.json specific validation
  'package.json': [
    'prettier --write',
    // Sort package.json (optional - uncomment if sort-package-json is installed)
    // 'sort-package-json',
  ],

  // Environment files - security check (warn only, don't fail)
  '.env*': (files) => {
    console.warn(
      '⚠️  Environment files changed. Please ensure no secrets are committed.'
    );
    return [];
  },
};
