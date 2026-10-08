import pg from "pg";
import type { ReviewFinding, ReviewStats } from "../review/pipeline.js";

export interface ReviewRecord {
  repo: string;
  prNumber: number;
  headSha: string;
  status: "completed" | "partial" | "error";
  provider: string;
  model: string;
  secondPass: boolean;
  filesReviewed: number;
  filesSkipped: number;
  totalLatencyMs: number;
  stats?: ReviewStats;
  findings?: { finding: ReviewFinding; posted: boolean }[];
  error?: string;
}

let pool: pg.Pool | undefined;

function isLocal(connectionString: string): boolean {
  const host = new URL(connectionString).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function getPool(connectionString: string): pg.Pool {
  pool ??= new pg.Pool({
    connectionString,
    // Free Supabase allows few connections, and we write one row set per review.
    max: 2,
    idleTimeoutMillis: 30_000,
    // Supabase requires TLS. Its certificate is signed by Supabase's own CA,
    // which Node does not trust by default, so we encrypt without verifying.
    ssl: isLocal(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}

export async function insertReview(
  client: pg.PoolClient | pg.Pool,
  r: ReviewRecord,
): Promise<number> {
  const s = r.stats;
  const { rows } = await client.query<{ id: string }>(
    `insert into reviews (repo, pr_number, head_sha, status, provider, model, second_pass,
       files_reviewed, files_skipped, files_failed, llm_calls, input_tokens, output_tokens,
       llm_latency_ms, total_latency_ms, pass1_findings, dropped_second_pass, dropped_low_conf,
       findings_posted, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     returning id`,
    [
      r.repo,
      r.prNumber,
      r.headSha,
      r.status,
      r.provider,
      r.model,
      r.secondPass,
      r.filesReviewed,
      r.filesSkipped,
      s?.failedFiles.length ?? 0,
      s?.llmCalls ?? 0,
      s?.inputTokens ?? 0,
      s?.outputTokens ?? 0,
      s?.llmLatencyMs ?? 0,
      r.totalLatencyMs,
      s?.pass1Findings ?? 0,
      s?.droppedSecondPass ?? 0,
      s?.droppedLowConfidence ?? 0,
      r.findings?.filter((f) => f.posted).length ?? 0,
      r.error?.slice(0, 500) ?? null,
    ],
  );
  return Number(rows[0]!.id);
}

async function insertFindings(
  client: pg.PoolClient,
  reviewId: number,
  findings: NonNullable<ReviewRecord["findings"]>,
): Promise<void> {
  if (findings.length === 0) return;
  // One multi-row insert: ($1,$2,...,$8), ($9,...)
  const values: unknown[] = [];
  const rows = findings.map(({ finding: f, posted }, i) => {
    values.push(
      reviewId,
      f.file,
      f.line,
      f.severity,
      f.confidence,
      f.fingerprint,
      posted,
      f.explanation,
    );
    const base = i * 8;
    return `(${Array.from({ length: 8 }, (_, j) => `$${base + j + 1}`).join(",")})`;
  });
  await client.query(
    `insert into findings (review_id, file, line, severity, confidence, fingerprint, posted, explanation)
     values ${rows.join(",")}`,
    values,
  );
}

// Writes one review and its findings in a transaction. Logging is best effort:
// a database problem is reported to the caller but must never fail a review.
export async function logReview(
  databaseUrl: string | undefined,
  record: ReviewRecord,
): Promise<void> {
  if (!databaseUrl) return;
  const client = await getPool(databaseUrl).connect();
  try {
    await client.query("begin");
    const id = await insertReview(client, record);
    await insertFindings(client, id, record.findings ?? []);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
