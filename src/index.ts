import { run } from "probot";
import app from "./app.js";

// Probot reads .env, verifies webhook signatures with WEBHOOK_SECRET, connects
// to smee.io when WEBHOOK_PROXY_URL is set, and serves GET /ping for health checks.
await run(app);
