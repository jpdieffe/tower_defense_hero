import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';

/** Short commit hash, so a phone can tell which build it is actually running. */
function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? 'development';
  }
}

const buildCommit = commit();

export default defineConfig({
  base: './',
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [{
    name: 'build-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ commit: buildCommit }),
      });
    },
  }],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
