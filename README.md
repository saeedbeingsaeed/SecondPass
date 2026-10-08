# SecondPass

An AI code review bot that runs as a GitHub App. When a pull request is opened or updated,
SecondPass reads the diff, asks an LLM to review it, and posts the results on the PR.

> Work in progress. Milestone 2: structured findings posted as inline comments.

## Local setup

Requirements: Node.js 20.18+ and a GitHub account. Everything runs on free tiers.

1. **Install**

   ```sh
   npm install
   cp .env.example .env
   ```

2. **Get a free Gemini API key.** Go to <https://aistudio.google.com/apikey>, sign in
   with a Google account, click **Create API key**, and paste it into `.env` as
   `GEMINI_API_KEY`. No credit card is needed. Leave billing off on the Google Cloud
   project so the key stays on the free tier.

3. **Register the GitHub App.** Run `npm run dev` and open <http://localhost:3000>.
   Click **Register a GitHub App**, choose a name, and confirm. Probot reads
   [`app.yml`](app.yml) for permissions and events, creates a smee.io channel for
   webhooks, and writes `APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET` and
   `WEBHOOK_PROXY_URL` into `.env`.

4. **Install the app on a test repo.** Follow the install link on the success page
   (or open the app's settings page → **Install App**). Choose **Only select
   repositories** and pick a throwaway repo.

5. **Restart** with `npm run dev`, open a pull request in that repo, and SecondPass
   posts a summary comment within a minute.

## Scripts

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Build and start the app locally |
| `npm test`          | Run the Vitest suite            |
| `npm run lint`      | ESLint and Prettier checks      |
| `npm run typecheck` | TypeScript type check           |
