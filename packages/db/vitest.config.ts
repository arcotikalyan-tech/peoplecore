import { defineConfig } from 'vitest/config';

// Each file migrates a fresh in-memory database before its tests (about 5 s on an idle machine). Half the cores and a
// generous setup timeout keep a busy machine from failing the run on setup alone.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 180_000, maxWorkers: '50%' } });
