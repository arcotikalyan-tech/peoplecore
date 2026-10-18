import root from '../../eslint.config.mjs';

export default [
  ...root,
  // The worker logs structured lines to stdout.
  { files: ['src/**/*.ts'], rules: { 'no-console': 'off' } },
];
