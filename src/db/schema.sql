-- SecondPass logging schema. Run once in the Supabase SQL editor (or psql).
-- Safe to re-run.

create table if not exists reviews (
  id                   bigserial primary key,
  created_at           timestamptz not null default now(),
  repo                 text not null,           -- "owner/name"
  pr_number            integer not null,
  head_sha             text not null,
  status               text not null,           -- completed | partial | error
  provider             text not null,
  model                text not null,
  second_pass          boolean not null,
  files_reviewed       integer not null default 0,
  files_skipped        integer not null default 0,
  files_failed         integer not null default 0,
  llm_calls            integer not null default 0,
  input_tokens         integer not null default 0,
  output_tokens        integer not null default 0,
  llm_latency_ms       integer not null default 0, -- time spent waiting on the model
  total_latency_ms     integer not null default 0, -- whole job, including GitHub calls and queueing
  pass1_findings       integer not null default 0,
  dropped_second_pass  integer not null default 0,
  dropped_low_conf     integer not null default 0,
  findings_posted      integer not null default 0,
  error                text                     -- short message only, never code
);

create index if not exists reviews_repo_pr on reviews (repo, pr_number);
create index if not exists reviews_created_at on reviews (created_at);

create table if not exists findings (
  id           bigserial primary key,
  review_id    bigint not null references reviews (id) on delete cascade,
  file         text not null,
  line         integer not null,
  severity     text not null,
  confidence   real not null,
  fingerprint  text not null,
  posted       boolean not null,                -- false if already posted on an earlier commit
  explanation  text not null
);

create index if not exists findings_review_id on findings (review_id);

-- Supabase exposes tables in the public schema through its REST API.
-- Row level security with no policies blocks that API completely; the app
-- connects as the database owner, which is not affected.
alter table reviews enable row level security;
alter table findings enable row level security;
