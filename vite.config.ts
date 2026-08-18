import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    minify: true,
    deps: {
      alwaysBundle: [/^@modelcontextprotocol\//, /^js-yaml$/, /^zod(?:\/|$)/],
      onlyBundle: [/^@modelcontextprotocol\//, /^js-yaml$/, /^zod(?:\/|$)/],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,mjs}'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      exclude: ['src/mcp/server.ts'],
      thresholds: {
        statements: 85,
        branches: 70,
        functions: 85,
        lines: 85,
      },
    },
  },
});
