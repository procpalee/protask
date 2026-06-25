-- 0007_project_archive_folders.sql
-- 상위 프로젝트(workspaces) 아카이브(숨김) + 프로젝트 폴더(그룹) 기능
-- 비파괴적(additive): 기존 데이터 영향 없음.

alter table public.workspaces add column if not exists archived boolean not null default false;

create table if not exists public.folders (
  id text primary key,
  name text not null,
  position double precision not null default 0,
  created_at timestamptz default now()
);

alter table public.workspaces add column if not exists folder_id text references public.folders(id) on delete set null;

-- RLS — 다른 테이블과 동일(로그인 사용자 전체 허용)
alter table public.folders enable row level security;
drop policy if exists "authenticated full access" on public.folders;
create policy "authenticated full access" on public.folders for all to authenticated using (true) with check (true);
