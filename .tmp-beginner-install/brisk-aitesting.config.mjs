import { defineConfig } from 'brisk-aitesting';

export default defineConfig({
  app: {
    name: "Beginner App",
    baseUrl: "http://127.0.0.1:3000",
    repoPath: '.',
  },
  auth: {
    type: 'none',
  },
});
