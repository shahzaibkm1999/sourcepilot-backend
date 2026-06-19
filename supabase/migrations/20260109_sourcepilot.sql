-- =============================================================
-- SourcePilot — extension schema (preserves existing tables)
-- =============================================================
-- Adds the pre-spec discovery workflow tables to the existing
-- AI Software Planning Assistant schema. Existing `projects` and
-- `specifications` tables are NOT modified.
--
-- Apply via Supabase SQL editor or `supabase db push`.
-- =============================================================

-- ------------------------------------------------------------
-- 1. Intakes — the original client request that opens a project
-- ------------------------------------------------------------
create table if not exists public.intakes (
    id            uuid primary key default gen_random_uuid(),
    project_id    uuid not null references public.projects(id) on delete cascade,
    project_type  text,           -- web | mobile | saas | internal | api | other
    engagement    text,           -- fixed_price | hourly
    timeline_pref text,           -- 1-2w | 1m | 2-3m | 3-6m | flexible
    requirement   text not null,  -- the original client request
    details       text,           -- optional additional notes
    constraints   text,           -- optional
    version       int not null default 1,
    created_at    timestamptz not null default now()
);

create index if not exists idx_intakes_project_created
    on public.intakes (project_id, created_at desc);

-- ------------------------------------------------------------
-- 2. Discoveries — AI analysis (ambiguities, missing info, risks, assumptions)
-- ------------------------------------------------------------
create table if not exists public.discoveries (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references public.projects(id) on delete cascade,
    ambiguities  jsonb,         -- [{area, question, priority}]
    missing_info jsonb,         -- [string]
    risks        jsonb,         -- [{title, severity, mitigation}]
    assumptions  jsonb,         -- [string]
    content      text,          -- full Markdown view
    version      int not null default 1,
    created_at   timestamptz not null default now()
);

create index if not exists idx_discoveries_project_created
    on public.discoveries (project_id, created_at desc);

-- ------------------------------------------------------------
-- 3. Clarifications — Q&A iterations
-- ------------------------------------------------------------
create table if not exists public.clarifications (
    id            uuid primary key default gen_random_uuid(),
    project_id    uuid not null references public.projects(id) on delete cascade,
    questions     jsonb not null,   -- [{id, area, question, answer?, status}]
    refined_input text,             -- refined requirement after answers
    version       int not null default 1,
    created_at    timestamptz not null default now()
);

create index if not exists idx_clarifications_project_created
    on public.clarifications (project_id, created_at desc);

-- ------------------------------------------------------------
-- 4. Scopes — In / Out / Future / Dependencies / Assumptions / Risks
-- ------------------------------------------------------------
create table if not exists public.scopes (
    id                    uuid primary key default gen_random_uuid(),
    project_id            uuid not null references public.projects(id) on delete cascade,
    in_scope              jsonb,
    out_of_scope          jsonb,
    future_considerations jsonb,
    dependencies          jsonb,
    assumptions           jsonb,
    risks                 jsonb,
    content               text,         -- Markdown view
    version               int not null default 1,
    created_at            timestamptz not null default now()
);

create index if not exists idx_scopes_project_created
    on public.scopes (project_id, created_at desc);

-- ------------------------------------------------------------
-- 5. Estimates — effort + budget
-- ------------------------------------------------------------
create table if not exists public.estimates (
    id                uuid primary key default gen_random_uuid(),
    project_id        uuid not null references public.projects(id) on delete cascade,
    items             jsonb not null,    -- [{area, hours, complexity, confidence}]
    budget_range      jsonb,             -- {min, max, currency} (fixed price)
    risk_buffer       int,               -- hours (fixed price)
    total_hours_low   int,
    total_hours_high  int,
    content           text,
    version           int not null default 1,
    created_at        timestamptz not null default now()
);

create index if not exists idx_estimates_project_created
    on public.estimates (project_id, created_at desc);

-- ------------------------------------------------------------
-- 6. Timelines — phased roadmap
-- ------------------------------------------------------------
create table if not exists public.timelines (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects(id) on delete cascade,
    phases      jsonb not null,    -- [{name, duration_weeks, milestones[], dependencies[]}]
    total_weeks int,
    content     text,
    version     int not null default 1,
    created_at  timestamptz not null default now()
);

create index if not exists idx_timelines_project_created
    on public.timelines (project_id, created_at desc);

-- ------------------------------------------------------------
-- 7. Proposals — client-facing document
-- ------------------------------------------------------------
create table if not exists public.proposals (
    id                uuid primary key default gen_random_uuid(),
    project_id        uuid not null references public.projects(id) on delete cascade,
    executive_summary text,
    understanding     text,
    scope_summary     text,
    deliverables      jsonb,
    content           text,             -- full Markdown proposal
    version           int not null default 1,
    created_at        timestamptz not null default now()
);

create index if not exists idx_proposals_project_created
    on public.proposals (project_id, created_at desc);

-- ------------------------------------------------------------
-- 8. Decisions — lightweight decision log
-- ------------------------------------------------------------
create table if not exists public.decisions (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects(id) on delete cascade,
    title       text not null,
    rationale   text,
    made_at     timestamptz not null default now()
);

create index if not exists idx_decisions_project_made
    on public.decisions (project_id, made_at desc);

-- ------------------------------------------------------------
-- 9. Artifact links — explicit lineage (graph edges)
-- ------------------------------------------------------------
create table if not exists public.artifact_links (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references public.projects(id) on delete cascade,
    source_type  text not null,   -- 'intake' | 'discovery' | 'clarification' | 'scope' | 'estimate' | 'timeline' | 'proposal' | 'specification'
    source_id    uuid not null,
    target_type  text not null,
    target_id    uuid not null,
    relation     text,            -- 'derived_from' | 'supersedes' | etc.
    created_at   timestamptz not null default now()
);

create index if not exists idx_artifact_links_project
    on public.artifact_links (project_id);

-- ------------------------------------------------------------
-- 10. Completeness — denormalized for fast dashboard read
-- ------------------------------------------------------------
create table if not exists public.completeness_scores (
    project_id  uuid primary key references public.projects(id) on delete cascade,
    score       int not null,         -- 0..100
    missing     jsonb,                -- [string]
    updated_at  timestamptz not null default now()
);

-- =============================================================
-- Row Level Security — MVP-permissive (anon + authenticated)
-- =============================================================

alter table public.intakes              enable row level security;
alter table public.discoveries          enable row level security;
alter table public.clarifications       enable row level security;
alter table public.scopes               enable row level security;
alter table public.estimates            enable row level security;
alter table public.timelines            enable row level security;
alter table public.proposals            enable row level security;
alter table public.decisions            enable row level security;
alter table public.artifact_links       enable row level security;
alter table public.completeness_scores  enable row level security;

do $$
declare
    t text;
begin
    for t in
        select unnest(array[
            'intakes','discoveries','clarifications','scopes','estimates',
            'timelines','proposals','decisions','artifact_links','completeness_scores'
        ])
    loop
        execute format('drop policy if exists "anon_all_%s" on public.%I', t, t);
        execute format(
            'create policy "anon_all_%s" on public.%I for all to anon, authenticated using (true) with check (true)',
            t, t
        );
    end loop;
end $$;
