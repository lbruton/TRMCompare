const { defineConfig, devices } = require('@playwright/test');

const config = {
  testDir: './tests',
  outputDir: './test-results',
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
};

// Only start local dev server when BASE_URL is not set
if (!process.env.BASE_URL) {
  config.webServer = {
    command: 'python3 -m http.server 8080',
    port: 8080,
    reuseExistingServer: true,
  };
}

module.exports = defineConfig(config);
