import nextVitals from 'eslint-config-next/core-web-vitals';
import root from '../../eslint.config.mjs';

export default [
  ...root,
  ...nextVitals,
  {
    // The secret key (service-role privileges) bypasses RLS. It may only be read in the admin module (see CLAUDE.md).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/admin.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Read env through src/lib/env.ts or src/server/admin.ts.' },
      ],
    },
  },
  { files: ['src/lib/env.ts'], rules: { 'no-restricted-properties': 'off' } },
  // The AI provider key is read only in the AI module, server side.
  { files: ['src/server/ai.ts'], rules: { 'no-restricted-properties': 'off' } },
  // Command-line scripts report their results on stdout.
  { files: ['scripts/**/*.ts'], rules: { 'no-console': 'off' } },
];
