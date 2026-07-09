import { createApp } from "./server";

const app = createApp();

const port = Number(process.env.PORT ?? 8080);

export default {
  port,
  fetch: app.fetch,
};
