import { test as base, expect } from "@playwright/test";
import { startTestServer } from "../helpers/test-server.mjs";

export const test = base.extend({
  installation: async ({}, use) => {
    const server = await startTestServer();
    try {
      await use(server);
    } finally {
      await server.dispose();
    }
  },
});
export { expect };
