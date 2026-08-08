import root from '../eslint.config.mjs';

export default [
  ...root,
  { ignores: ['src/test/**'] },
  {
    // The launcher is plain JS, which the root config only gives Node globals
    // to for .ts files.
    files: ['bin/**/*.js'],
    languageOptions: {
      globals: { process: 'readonly' },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
];
