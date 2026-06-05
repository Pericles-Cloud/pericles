# ADR-0001: Use Vitest for Testing

## Status
Accepted

## Date
2025-05-28

## Context
The backend codebase lacked a testing framework. We needed a modern, fast test runner that integrates well with TypeScript and supports the ES modules used throughout the project.

## Decision
Adopt Vitest as the primary testing framework for the backend.

Configuration:
- `vitest.config.ts` with TypeScript path aliases
- Global test utilities enabled
- V8 coverage provider
- JUnit reporter for CI integration

## Consequences

### Positive
- Native ESM support (no transpilation workarounds)
- Jest-compatible API (familiar to most developers)
- Fast execution with smart watch mode
- Built-in coverage with V8 provider
- TypeScript support out of the box

### Negative
- Slightly different from Jest in edge cases
- Smaller ecosystem than Jest (though growing)

### Neutral
- CI workflow uses `--reporter=junit` for test result artifacts

## Alternatives Considered
1. **Jest** - Requires additional ESM configuration, slower
2. **Node.js native test runner** - Less mature, limited ecosystem
3. **Mocha + Chai** - More setup required, no built-in TypeScript

## References
- Vitest docs: https://vitest.dev
- `.claude/rules/12-testing.md` - Testing standards
