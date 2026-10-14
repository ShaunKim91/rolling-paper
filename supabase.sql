-- 우리 팀 롤링페이퍼 — Supabase SQL Editor에서 한 번 실행하세요. (기존 테이블과 겹치지 않도록 rp_ 접두사 사용)

create table if not exists public.rp_rooms (
  room text primary key check (room ~ '^[A-Za-z0-9_가-힣-]{1,32}$'),
  title text not null check (char_length(title) between 1 and 40),
  deadline timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.rp_notes (
  id bigint generated always as identity primary key,
  room text not null references public.rp_rooms(room) on delete cascade,
  author text not null default '익명' check (char_length(author) <= 12),
  message text not null check (char_length(message) between 1 and 100),
  color text not null default 'yellow' check (color in ('yellow','pink','mint','blue','purple','orange')),
  emoji text check (emoji is null or char_length(emoji) <= 4),
  photo_url text check (photo_url is null or char_length(photo_url) <= 400),
  hearts integer not null default 0 check (hearts >= 0),
  created_at timestamptz not null default now()
);
create index if not exists rp_notes_room_idx on public.rp_notes (room, created_at desc);

alter table public.rp_rooms enable row level security;
alter table public.rp_notes enable row level security;

-- 방: 누구나 읽기/만들기 (수정·삭제 불가)
drop policy if exists "rp rooms read" on public.rp_rooms;
create policy "rp rooms read" on public.rp_rooms for select to anon using (true);
drop policy if exists "rp rooms insert" on public.rp_rooms;
create policy "rp rooms insert" on public.rp_rooms for insert to anon with check (true);

-- 글: 누구나 읽기, 마감 전에만 쓰기 (수정·삭제 불가, 하트는 아래 함수로만)
drop policy if exists "rp notes read" on public.rp_notes;
create policy "rp notes read" on public.rp_notes for select to anon using (true);
drop policy if exists "rp notes insert" on public.rp_notes;
create policy "rp notes insert" on public.rp_notes for insert to anon
  with check (
    hearts = 0 and exists (
      select 1 from public.rp_rooms r
      where r.room = rp_notes.room and (r.deadline is null or r.deadline > now())
    )
  );

-- 하트 +1 / -1 (hearts 컬럼만 바뀌도록 함수로 제한)
create or replace function public.rp_bump_heart(note_id bigint, delta int)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  update public.rp_notes set hearts = greatest(0, hearts + case when delta < 0 then -1 else 1 end)
  where id = note_id returning hearts into v;
  return v;
end $$;
revoke all on function public.rp_bump_heart(bigint, int) from public;
grant execute on function public.rp_bump_heart(bigint, int) to anon;

-- 실시간
alter table public.rp_notes replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.rp_notes;
exception when duplicate_object then null; end $$;

-- 사진 저장소 (무료 용량 보호: 파일당 300KB, JPEG만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 307200, array['image/jpeg'])
on conflict (id) do update set file_size_limit = 307200, allowed_mime_types = array['image/jpeg'], public = true;

drop policy if exists "rp photos upload" on storage.objects;
create policy "rp photos upload" on storage.objects for insert to anon with check (bucket_id = 'photos');
drop policy if exists "rp photos read" on storage.objects;
create policy "rp photos read" on storage.objects for select to anon using (bucket_id = 'photos');
