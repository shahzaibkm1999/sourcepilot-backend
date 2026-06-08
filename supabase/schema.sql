-- =============================================================
-- AI Software Planning Assistant - Supabase Schema
-- =============================================================
-- Run this in the Supabase SQL editor (or via supabase CLI)
-- to create the tables required by the AI Software Planning Assistant backend.
-- =============================================================

-- Enable UUID generation (Supabase has this by default, but explicit is good).
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- projects
-- Stores high-level project metadata. One row per project.
-- ------------------------------------------------------------
create table if not exists public.projects (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    description text,
    created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- specifications
-- Stores generated specification content, versioned per project.
-- Newer versions are inserted as new rows; the latest row is
-- considered the "current" version for that project.
-- ------------------------------------------------------------
create table if not exists public.specifications (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references public.projects(id) on delete cascade,
    content     text not null,
    version     integer not null default 1,
    created_at  timestamptz not null default now()
);

-- Helpful index for "give me the latest spec for project X".
create index if not exists idx_specifications_project_created
    on public.specifications (project_id, created_at desc);

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
-- For the MVP we keep things simple: anon role can read/write
-- everything. In production you would scope this down to
-- authenticated users and tie rows to a user_id column.
-- ------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.specifications enable row level security;

drop policy if exists "anon_all_projects" on public.projects;
create policy "anon_all_projects"
    on public.projects
    for all
    to anon, authenticated
    using (true)
    with check (true);

drop policy if exists "anon_all_specifications" on public.specifications;
create policy "anon_all_specifications"
    on public.specifications
    for all
    to anon, authenticated
    using (true)
    with check (true);
