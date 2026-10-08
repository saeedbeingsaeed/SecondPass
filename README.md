# SecondPass

An AI code review bot that runs as a GitHub App. When a pull request is opened or updated,
SecondPass reads the diff, asks an LLM to review it, and posts the results on the PR.

> Work in progress. Milestone 4: Postgres logging, Groq provider and evaluation harness.

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

## Per-repo configuration

Add `.secondpass.yml` to the root of the repo's **default branch** (it is not read from PR
branches, so a PR cannot switch off its own review). Every key is optional:

```yaml
# Glob patterns for paths to skip, in addition to lockfiles, generated files and binaries.
ignore:
  - "docs/**"
  - "*.snap"
# Findings below this confidence (0-1) are not posted. Default 0.6.
confidenceThreshold: 0.7
# Which kinds of findings to post. Default: bug, security, performance (style is off).
severities: [bug, security, performance]
```

If the file is invalid, SecondPass uses the defaults and says so in the summary comment.

## Logging to Postgres (optional)

Every review is logged with token counts, latency and its findings. Code and prompts are never stored.

1. Create a free project at <https://supabase.com> (no card needed).
2. Open **SQL Editor**, paste the contents of [`src/db/schema.sql`](src/db/schema.sql), and run it.
3. Click **Connect**, copy the **Session pooler** connection string, put your database
   password in it, and set it as `DATABASE_URL` in `.env`.

If `DATABASE_URL` is empty, logging is off and everything else works the same.

## Switching LLM providers

Set `LLM_PROVIDER=gemini` or `LLM_PROVIDER=groq` in `.env`. Each provider has its own key,
model, request spacing and per-request size settings (see [`.env.example`](.env.example)).

## Evaluation

`npm run eval` runs the review pipeline on pull requests with a known bug, **without posting
anything**, and reports how many bugs were caught (recall), comments per PR and tokens per PR.

```sh
npm run eval                                          # default provider, pass 2 on and off
npm run eval -- --provider gemini,groq                # compare providers
npm run eval -- --second-pass off                     # only one setting
npm run eval -- --cases my-cases.json --tolerance 2   # custom cases, looser line matching
```

Cases live in [`eval/cases.json`](eval/cases.json). Each one names a PR and the file and line
range (in the PR's version of the file) where the known bug is:

```json
{
  "repo": "owner/name",
  "pr": 12,
  "description": "What the bug is, for humans",
  "bug": { "file": "src/cart.js", "startLine": 26, "endLine": 30 }
}
```

The three example cases point at
[secondpass-eval-fixtures](https://github.com/saeedbeingsaeed/secondpass-eval-fixtures/pulls),
where each open PR contains one planted bug. Results are printed as a Markdown table and
saved in full to `eval/results/`.

## Scripts

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Build and start the app locally |
| `npm run eval`      | Run the evaluation harness      |
| `npm test`          | Run the Vitest suite            |
| `npm run lint`      | ESLint and Prettier checks      |
| `npm run typecheck` | TypeScript type check           |
