-- feed_counters — the interaction layer's TRIGGERS, i.e. everything about `feed_comments` and
-- `feed_likes` that drizzle-kit cannot model. Its companion `20260922162440_feed_interactions.sql`
-- is the GENERATED half (both tables, both policies, the composite self-referencing foreign key,
-- `unique (id, depth)`, the three partial unique indexes and the two `num_nonnulls` checks —
-- drizzle-kit 0.31.10 emitted every one of them cleanly, so nothing was moved out of it and
-- `pnpm db:generate` stays a no-op).
--
-- WHY `feed_likes` HAS NULLABLE TYPED TARGET COLUMNS AND NOT A POLYMORPHIC PAIR — do not "fix" this:
-- SCHEMA-CONVENTIONS §(e).1 sketches a polymorphic kind+id pair, which cannot carry a foreign key;
-- a deleted post would then leave orphan like rows and the counter triggers below would have
-- nothing to cascade from. §(e).3's nullable-FK form — nullable target columns, a CHECK that
-- exactly one is set, one PARTIAL unique index per target — keeps referential integrity AND is what
-- the ROADMAP Phase 4 note specifies. What §(e).1 actually forbids, a separate like table per
-- content type, is still forbidden: one behaviour, ONE table, typed targets.
--
-- WHY THE COUNTERS LIVE IN TRIGGERS AT ALL: `feed_posts.like_count`, `feed_posts.comment_count` and
-- `feed_comments.like_count` are the ONLY writers of those columns. An application-side
-- `update … set like_count = like_count + 1` is a second statement that must also succeed; the day
-- it does not, the counter drifts from the rows it summarises and nothing notices.
--
-- WHY NEITHER FUNCTION RUNS WITH THE DEFINER'S RIGHTS (contrast `app.ensure_member_profile()` in
-- 20260921190227_member_profiles_search.sql, which needs both the elevated right and the hardening
-- that comes with it): these run on the writer's OWN row, inside the writer's own tenant lane,
-- against tables that carry a permissive `for all` isolation policy the writer already satisfies.
-- They need no elevated right, so they get none — an elevated trigger here would be a standing
-- way to move another tenant's counter. `set search_path = ''` plus fully-qualified names is kept
-- anyway: it costs nothing and makes the functions immune to a hostile search_path.

-- Likes: one function for both targets, because it is ONE behaviour over ONE table. `post_id` and
-- `comment_id` are mutually exclusive (`feed_likes_target_chk`), so the two branches can never both
-- fire. `story_id` is the Phase 5 slot: a story like matches neither branch today and adjusts
-- nothing, which is correct until `stories.like_count` exists.
create or replace function app.feed_like_count() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.post_id is not null then
      update public.feed_posts set like_count = like_count + 1 where id = new.post_id;
    elsif new.comment_id is not null then
      update public.feed_comments set like_count = like_count + 1 where id = new.comment_id;
    end if;
  elsif tg_op = 'DELETE' then
    -- A decrement only ever fires on the delete of a row that EXISTED, so the counter cannot go
    -- below zero. There is deliberately no `greatest(0, …)` clamp: a clamp would hide drift instead
    -- of letting the pgTAP reconciliation assertion surface it.
    if old.post_id is not null then
      update public.feed_posts set like_count = like_count - 1 where id = old.post_id;
    elsif old.comment_id is not null then
      update public.feed_comments set like_count = like_count - 1 where id = old.comment_id;
    end if;
  end if;
  return null;
end
$$;--> statement-breakpoint

-- Comments: the counter must follow the SOFT delete, which is an UPDATE, not a DELETE (Pitfall 5).
-- A trigger that fired only on insert/delete would leave `comment_count` stuck and every post would
-- show a phantom comment forever. Hence `update of deleted_at` and a branch on the TRANSITION.
--
-- ROOT COMMENTS AND REPLIES BOTH COUNT toward the post's `comment_count` — a thread's replies are
-- comments, and the number under a post is "how many people wrote something here", not "how many
-- top-level threads exist". Do not "optimise" the `depth = 1` rows out of this count; the pgTAP
-- reconciliation assertion counts every live `feed_comments` row for the post and would go red.
create or replace function app.feed_comment_count() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.post_id is not null and new.deleted_at is null then
      update public.feed_posts set comment_count = comment_count + 1 where id = new.post_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.post_id is not null and old.deleted_at is null then
      update public.feed_posts set comment_count = comment_count - 1 where id = old.post_id;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.post_id is not null then
      if old.deleted_at is null and new.deleted_at is not null then
        -- the D-61 soft delete: the row stays for Phase 8 moderation, the count does not
        update public.feed_posts set comment_count = comment_count - 1 where id = new.post_id;
      elsif old.deleted_at is not null and new.deleted_at is null then
        -- a Phase 8 restore; every other update of deleted_at changes nothing
        update public.feed_posts set comment_count = comment_count + 1 where id = new.post_id;
      end if;
    end if;
  end if;
  return null;
end
$$;--> statement-breakpoint

grant execute on function app.feed_like_count() to authenticated, service_role, api_user;--> statement-breakpoint
grant execute on function app.feed_comment_count() to authenticated, service_role, api_user;--> statement-breakpoint

drop trigger if exists feed_likes_count on public.feed_likes;--> statement-breakpoint
create trigger feed_likes_count
  after insert or delete on public.feed_likes
  for each row execute function app.feed_like_count();--> statement-breakpoint

drop trigger if exists feed_comments_count on public.feed_comments;--> statement-breakpoint
create trigger feed_comments_count
  after insert or delete or update of deleted_at on public.feed_comments
  for each row execute function app.feed_comment_count();
