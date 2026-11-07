import { fileURLToPath } from 'node:url';

export default {
  // The repo itself, wherever it's checked out, so `npm test` works from any folder in it.
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    globals: false,
  },
};
