import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    files: ['app/**', 'src/**'],
    ignores: ['src/text.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'react-native', importNames: ['Text'], message: "Use Text from '@/ui': with Android's Bold text on, react-native's Text cuts words short." }],
      }],
    },
  },
];
