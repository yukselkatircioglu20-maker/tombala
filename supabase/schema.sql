-- =====================================================================
--  TOMBALA — Supabase veritabanı kurulumu
--
--  Kullanım: Supabase paneli → SQL Editor → New query → bu dosyanın
--  TAMAMINI yapıştırın → Run. Dosya tekrar çalıştırılabilir; güncelleme
--  için yeniden çalıştırmak mevcut verileri silmez.
--
--  Mimari:
--   * public.games  : oyunun herkese açık durumu (Realtime ile yayınlanır)
--   * app.*         : gizli tablolar (kullanıcılar, oturumlar, talepler...)
--   * public.tb_*   : sitenin çağırdığı fonksiyonlar (RPC)
--   * pg_cron       : her saniye app.tick() → otomatik top çekimi
-- =====================================================================

set client_min_messages = warning;

create extension if not exists pgcrypto with schema extensions;

-- Yerel test ortamı için (Supabase'de bu roller zaten vardır)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists app;
revoke all on schema app from public;

-- ---------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------

create table if not exists app.users (
  id          bigint generated always as identity primary key,
  username    text not null,
  name        text not null,
  pass_hash   text not null,
  role        text not null default 'user' check (role in ('user', 'admin')),
  balance     numeric(14, 2) not null default 0 check (balance >= 0),
  blocked     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists users_username_lower_idx on app.users (lower(username));

create table if not exists app.sessions (
  token_hash  text primary key,
  user_id     bigint not null references app.users (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on app.sessions (user_id);

create table if not exists app.login_attempts (
  key    text primary key,
  count  int not null default 0,
  until  timestamptz not null
);

create table if not exists app.settings (
  id                     int primary key default 1 check (id = 1),
  card_price             numeric(12, 2) not null default 100,
  draw_interval_sec      int not null default 6,
  pool_mode              text not null default 'sales' check (pool_mode in ('sales', 'fixed')),
  payout_percent         numeric(6, 2) not null default 80,
  fixed_pool             numeric(14, 2) not null default 25000,
  prize_split            jsonb not null default '{"cinko1": 20, "cinko2": 30, "tombala": 50}',
  auto_approve           boolean not null default false,
  max_cards_per_request  int not null default 10,
  payment_info           text not null default E'Banka: Örnek Bank\nIBAN: TR00 0000 0000 0000 0000 0000 00\nAlıcı: Tombala\nAçıklama kısmına kullanıcı adınızı yazın.'
);
insert into app.settings (id) values (1) on conflict (id) do nothing;

-- Oyunun herkese açık durumu. Zamanlar milisaniye (epoch) olarak tutulur.
create table if not exists public.games (
  id                     bigint generated always as identity primary key,
  status                 text not null default 'waiting'
                         check (status in ('waiting', 'running', 'paused', 'finished', 'cancelled')),
  created_ms             bigint not null default (extract(epoch from now()) * 1000)::bigint,
  scheduled_ms           bigint,
  started_ms             bigint,
  ended_ms               bigint,
  resumed_ms             bigint,
  next_draw_ms           bigint,
  last_draw_ms           bigint,
  active_ms              bigint not null default 0,
  drawn                  int[] not null default '{}',
  pool                   numeric(14, 2) not null default 0,
  pool_locked            boolean not null default false,
  prize_split            jsonb,
  prize_amounts          jsonb not null default '{"cinko1": 0, "cinko2": 0, "tombala": 0}',
  prizes                 jsonb not null default '{"cinko1": null, "cinko2": null, "tombala": null}',
  taken                  int[] not null default '{}',
  sold_count             int not null default 0,
  player_count           int not null default 0,
  card_price             numeric(12, 2) not null default 100,
  draw_interval_sec      int not null default 6,
  max_cards_per_request  int not null default 10,
  updated_ms             bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint
);

create table if not exists app.game_cards (
  game_id  bigint not null references public.games (id) on delete cascade,
  card_no  int not null,
  grid     jsonb not null,
  r1       int[] not null,
  r2       int[] not null,
  r3       int[] not null,
  primary key (game_id, card_no)
);

create table if not exists app.purchases (
  id           bigint generated always as identity primary key,
  game_id      bigint not null references public.games (id) on delete cascade,
  user_id      bigint not null references app.users (id) on delete cascade,
  cards        int[] not null,
  unit_price   numeric(12, 2) not null,
  total        numeric(14, 2) not null,
  status       text not null default 'pending'
               check (status in ('pending', 'awaiting_payment', 'paid', 'rejected', 'cancelled')),
  reason       text,
  paid_via     text,
  refunded     boolean not null default false,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  paid_at      timestamptz,
  closed_at    timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists purchases_game_status_idx on app.purchases (game_id, status);
create index if not exists purchases_user_idx on app.purchases (user_id);

create table if not exists app.wins (
  id       bigint generated always as identity primary key,
  game_id  bigint not null references public.games (id) on delete cascade,
  user_id  bigint not null references app.users (id) on delete cascade,
  card_no  int not null,
  prize    text not null,
  amount   numeric(14, 2) not null,
  at       timestamptz not null default now()
);
create index if not exists wins_at_idx on app.wins (at);
create index if not exists wins_user_idx on app.wins (user_id);

create table if not exists app.notifications (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references app.users (id) on delete cascade,
  text         text not null,
  type         text not null default 'info',
  purchase_id  bigint,
  read         boolean not null default false,
  at           timestamptz not null default now()
);
create index if not exists notifications_user_idx on app.notifications (user_id, id);

-- updated_* alanlarını otomatik güncelle
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

create or replace function app.touch_updated_ms() returns trigger language plpgsql as $$
begin
  new.updated_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;

drop trigger if exists users_touch on app.users;
create trigger users_touch before update on app.users for each row execute function app.touch_updated_at();
drop trigger if exists purchases_touch on app.purchases;
create trigger purchases_touch before update on app.purchases for each row execute function app.touch_updated_at();
drop trigger if exists games_touch on public.games;
create trigger games_touch before update on public.games for each row execute function app.touch_updated_ms();

-- ---------------------------------------------------------------------
-- Yardımcı fonksiyonlar (gizli şema)
-- ---------------------------------------------------------------------

create or replace function app.ms(ts timestamptz) returns bigint language sql immutable as $$
  select (extract(epoch from ts) * 1000)::bigint
$$;

create or replace function app.now_ms() returns bigint language sql volatile as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

create or replace function app.rand_int(n int) returns int language sql volatile as $$
  select (('x' || lpad(encode(extensions.gen_random_bytes(6), 'hex'), 16, '0'))::bit(64)::bigint % n)::int
$$;

create or replace function app.fmt_tl(n numeric) returns text language sql immutable as $$
  select case when n = trunc(n)
    then replace(to_char(n, 'FM999G999G999G990'), ',', '.')
    else replace(replace(replace(to_char(n, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.')
  end || ' TL'
$$;

create or replace function app.prize_label(k text) returns text language sql immutable as $$
  select case k when 'cinko1' then '1. Çinko' when 'cinko2' then '2. Çinko' when 'tombala' then 'Tombala' else k end
$$;

create or replace function app.user_json(u app.users) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', u.id, 'name', u.name, 'username', u.username, 'role', u.role,
    'balance', u.balance, 'blocked', u.blocked, 'createdAt', app.ms(u.created_at))
$$;

create or replace function app.token_hash(p_token text) returns text language sql immutable as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function app.token_user(p_token text) returns app.users language sql stable as $$
  select u.* from app.sessions s join app.users u on u.id = s.user_id
  where s.token_hash = app.token_hash(p_token) and s.expires_at > now() and not u.blocked
$$;

create or replace function app.require_user(p_token text) returns app.users language plpgsql stable as $$
declare
  u app.users;
begin
  select * into u from app.token_user(p_token);
  if u.id is null then
    raise exception 'Oturum açmanız gerekiyor.' using errcode = 'TB401';
  end if;
  return u;
end $$;

create or replace function app.require_admin(p_token text) returns app.users language plpgsql stable as $$
declare
  u app.users;
begin
  u := app.require_user(p_token);
  if u.role <> 'admin' then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = 'TB403';
  end if;
  return u;
end $$;

create or replace function app.new_session(p_user bigint, p_remember boolean) returns text language plpgsql as $$
declare
  t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into app.sessions (token_hash, user_id, expires_at)
  values (app.token_hash(t), p_user, now() + case when p_remember then interval '30 days' else interval '12 hours' end);
  delete from app.sessions where expires_at < now();
  return t;
end $$;

create or replace function app.notify(p_user bigint, p_text text, p_type text default 'info', p_purchase bigint default null)
returns void language plpgsql as $$
begin
  insert into app.notifications (user_id, text, type, purchase_id) values (p_user, p_text, p_type, p_purchase);
  delete from app.notifications
  where user_id = p_user
    and id < (select min(id) from (select id from app.notifications where user_id = p_user order by id desc limit 50) t);
end $$;

create or replace function app.current_game() returns public.games language sql stable as $$
  select * from public.games order by id desc limit 1
$$;

create or replace function app.purchase_json(p app.purchases) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'gameId', p.game_id, 'userId', p.user_id, 'cards', to_jsonb(p.cards),
    'unitPrice', p.unit_price, 'total', p.total, 'status', p.status, 'reason', p.reason,
    'paidVia', p.paid_via, 'refunded', p.refunded,
    'createdAt', app.ms(p.created_at), 'approvedAt', app.ms(p.approved_at),
    'paidAt', app.ms(p.paid_at), 'closedAt', app.ms(p.closed_at),
    'name', coalesce(u.name, '?'), 'username', coalesce(u.username, '?'))
  from (select 1) x left join app.users u on u.id = p.user_id
$$;

create or replace function app.elapsed_ms(g public.games) returns bigint language sql volatile as $$
  select g.active_ms + case when g.status = 'running' and g.resumed_ms is not null
                            then app.now_ms() - g.resumed_ms else 0 end
$$;

create or replace function app.state_json(g public.games) returns jsonb language sql volatile as $$
  select jsonb_build_object(
    'id', g.id, 'status', g.status,
    'createdAt', g.created_ms, 'scheduledAt', g.scheduled_ms, 'startedAt', g.started_ms, 'endedAt', g.ended_ms,
    'elapsedMs', app.elapsed_ms(g), 'nextDrawAt', g.next_draw_ms, 'serverNow', app.now_ms(),
    'drawn', to_jsonb(g.drawn), 'pool', g.pool, 'prizeAmounts', g.prize_amounts, 'prizes', g.prizes,
    'taken', to_jsonb(g.taken), 'soldCount', g.sold_count, 'playerCount', g.player_count, 'cardCount', 100,
    'cardPrice', g.card_price, 'drawIntervalSec', g.draw_interval_sec,
    'maxCardsPerRequest', g.max_cards_per_request, 'updatedAt', g.updated_ms)
$$;

-- Satış, havuz ve ayar özetini oyun satırına yazar (Realtime ile herkese gider)
create or replace function app.refresh_game(p_game bigint) returns void language plpgsql as $$
declare
  g public.games;
  s app.settings;
  v_taken int[];
  v_sold int;
  v_players int;
  v_revenue numeric;
  v_pool numeric;
  v_split jsonb;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then return; end if;
  select * into s from app.settings where id = 1;
  select coalesce(array_agg(c order by c), '{}') into v_taken
    from app.purchases p, unnest(p.cards) c
    where p.game_id = p_game and p.status in ('pending', 'awaiting_payment', 'paid');
  select coalesce(sum(cardinality(cards)), 0), count(distinct user_id), coalesce(sum(total), 0)
    into v_sold, v_players, v_revenue
    from app.purchases where game_id = p_game and status = 'paid';
  if g.pool_locked then
    v_pool := g.pool;
    v_split := coalesce(g.prize_split, s.prize_split);
  else
    v_pool := case when s.pool_mode = 'fixed' then s.fixed_pool
                   else round(v_revenue * s.payout_percent / 100, 2) end;
    v_split := s.prize_split;
  end if;
  update public.games set
    taken = v_taken,
    sold_count = v_sold,
    player_count = v_players,
    pool = v_pool,
    prize_amounts = jsonb_build_object(
      'cinko1', round(v_pool * (v_split ->> 'cinko1')::numeric / 100, 2),
      'cinko2', round(v_pool * (v_split ->> 'cinko2')::numeric / 100, 2),
      'tombala', round(v_pool * (v_split ->> 'tombala')::numeric / 100, 2)),
    card_price = s.card_price,
    draw_interval_sec = s.draw_interval_sec,
    max_cards_per_request = s.max_cards_per_request
  where id = p_game;
end $$;

-- Tombala kartı: 3 satır x 5 sütun, boş hücre yok (15 sayı).
-- Sütun aralıkları: 1-18, 19-36, 37-54, 55-72, 73-90; her sütunda 3 sayı, yukarıdan aşağı artan.
create or replace function app.generate_card() returns jsonb language plpgsql volatile as $$
declare
  c int;
  k int;
  picked int[];
  cells int[] := array_fill(0, array[15]);
begin
  for c in 1..5 loop
    select array_agg(v order by v) into picked
      from (select v from generate_series((c - 1) * 18 + 1, c * 18) v order by random() limit 3) t;
    for k in 1..3 loop
      cells[(k - 1) * 5 + c] := picked[k];
    end loop;
  end loop;
  return jsonb_build_array(to_jsonb(cells[1:5]), to_jsonb(cells[6:10]), to_jsonb(cells[11:15]));
end $$;

create or replace function app.row_nums(grid jsonb, i int) returns int[] language sql immutable as $$
  select coalesce(array_agg(x::int), '{}') from jsonb_array_elements_text(grid -> i) x where x::int > 0
$$;

create or replace function app.create_game() returns public.games language plpgsql as $$
declare
  g public.games;
  grid jsonb;
  seen text[] := '{}';
  n int := 0;
begin
  insert into public.games default values returning * into g;
  while n < 100 loop
    grid := app.generate_card();
    continue when grid::text = any (seen);
    seen := seen || grid::text;
    n := n + 1;
    insert into app.game_cards (game_id, card_no, grid, r1, r2, r3)
    values (g.id, n, grid, app.row_nums(grid, 0), app.row_nums(grid, 1), app.row_nums(grid, 2));
  end loop;
  perform app.refresh_game(g.id);
  select * into g from public.games where id = g.id;
  return g;
end $$;

create or replace function app.lock_current() returns public.games language plpgsql as $$
declare
  g public.games;
begin
  select * into g from public.games where id = (select max(id) from public.games) for update;
  if g.id is null then
    g := app.create_game();
    select * into g from public.games where id = g.id for update;
  end if;
  return g;
end $$;

create or replace function app.cancel_open_requests(p_game bigint, p_why text) returns void language plpgsql as $$
declare
  p app.purchases;
begin
  for p in
    update app.purchases set status = 'cancelled', reason = p_why, closed_at = now()
    where game_id = p_game and status in ('pending', 'awaiting_payment') returning *
  loop
    perform app.notify(p.user_id, 'Kart talebiniz iptal edildi: ' || p_why, 'error', p.id);
  end loop;
end $$;

create or replace function app.finish_game(p_game bigint) returns void language plpgsql as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game;
  update public.games set active_ms = app.elapsed_ms(g), status = 'finished', resumed_ms = null,
    next_draw_ms = null, ended_ms = app.now_ms()
  where id = p_game;
end $$;

-- Çekilişten sonra çinko/tombala kontrolü ve ödül dağıtımı
create or replace function app.check_winners(p_game bigint) returns void language plpgsql as $$
declare
  g public.games;
  k text;
  need int;
  n int;
  amount numeric;
  share numeric;
  list jsonb;
  w record;
  u app.users;
begin
  select * into g from public.games where id = p_game;
  foreach k in array array['cinko1', 'cinko2', 'tombala'] loop
    continue when jsonb_typeof(g.prizes -> k) = 'object';
    need := case k when 'cinko1' then 1 when 'cinko2' then 2 else 3 end;
    select count(*) into n
      from app.game_cards gc
      join app.purchases p on p.game_id = gc.game_id and p.status = 'paid' and gc.card_no = any (p.cards)
      where gc.game_id = p_game
        and ((gc.r1 <@ g.drawn)::int + (gc.r2 <@ g.drawn)::int + (gc.r3 <@ g.drawn)::int) >= need;
    exit when n = 0; -- ödüller sırayla verilir
    amount := coalesce((g.prize_amounts ->> k)::numeric, 0);
    share := round(floor(amount * 100 / n) / 100, 2);
    list := '[]'::jsonb;
    for w in
      select gc.card_no, p.user_id
        from app.game_cards gc
        join app.purchases p on p.game_id = gc.game_id and p.status = 'paid' and gc.card_no = any (p.cards)
        where gc.game_id = p_game
          and ((gc.r1 <@ g.drawn)::int + (gc.r2 <@ g.drawn)::int + (gc.r3 <@ g.drawn)::int) >= need
        order by gc.card_no
    loop
      update app.users set balance = balance + share where id = w.user_id returning * into u;
      insert into app.wins (game_id, user_id, card_no, prize, amount) values (p_game, w.user_id, w.card_no, k, share);
      perform app.notify(w.user_id, format('Tebrikler! %s numaralı kartınızla %s yaptınız: %s',
        w.card_no, app.prize_label(k), app.fmt_tl(share)), 'win');
      list := list || jsonb_build_object('userId', w.user_id, 'name', coalesce(u.name, '?'),
        'username', coalesce(u.username, '?'), 'cardNo', w.card_no, 'amount', share);
    end loop;
    g.prizes := jsonb_set(g.prizes, array[k], jsonb_build_object(
      'amount', amount, 'winners', list, 'drawIndex', cardinality(g.drawn), 'at', app.now_ms()));
  end loop;
  update public.games set prizes = g.prizes where id = p_game and prizes is distinct from g.prizes;
  if jsonb_typeof(g.prizes -> 'tombala') = 'object' then
    perform app.finish_game(p_game);
  end if;
end $$;

create or replace function app.draw_one(p_game bigint) returns int language plpgsql as $$
declare
  g public.games;
  remaining int[];
  num int;
begin
  select * into g from public.games where id = p_game for update;
  if g.status not in ('running', 'paused') then
    raise exception 'Oyun aktif değil.';
  end if;
  select array_agg(x) into remaining from generate_series(1, 90) x where not (x = any (g.drawn));
  if remaining is null then
    raise exception 'Tüm toplar çekildi.';
  end if;
  num := remaining[1 + app.rand_int(cardinality(remaining))];
  update public.games set
    drawn = drawn || num,
    last_draw_ms = app.now_ms(),
    next_draw_ms = case when status = 'running' then app.now_ms() + draw_interval_sec * 1000 else null end
  where id = p_game;
  perform app.check_winners(p_game);
  select * into g from public.games where id = p_game;
  if g.status = 'running' and cardinality(g.drawn) >= 90 then
    perform app.finish_game(p_game);
  end if;
  return num;
end $$;

create or replace function app.start_game() returns public.games language plpgsql as $$
declare
  g public.games;
  s app.settings;
  uid bigint;
begin
  g := app.lock_current();
  if g.status = 'paused' then
    update public.games set status = 'running', resumed_ms = app.now_ms(), next_draw_ms = app.now_ms() + 1500
    where id = g.id returning * into g;
    return g;
  end if;
  if g.status <> 'waiting' then
    raise exception 'Oyun başlatılamaz. Önce yeni bir oyun oluşturun.';
  end if;
  if not exists (select 1 from app.purchases where game_id = g.id and status = 'paid') then
    raise exception 'Ödemesi tamamlanmış kart olmadan oyun başlatılamaz.';
  end if;
  perform app.cancel_open_requests(g.id, 'Oyun başladı, satış kapandı.');
  perform app.refresh_game(g.id);
  select * into s from app.settings where id = 1;
  update public.games set
    pool_locked = true, prize_split = s.prize_split, status = 'running',
    started_ms = app.now_ms(), resumed_ms = app.now_ms(), scheduled_ms = null,
    next_draw_ms = app.now_ms() + 4000
  where id = g.id returning * into g;
  for uid in select distinct user_id from app.purchases where game_id = g.id and status = 'paid' loop
    perform app.notify(uid, 'Oyun başladı! Kartlarınız hazır, bol şans!', 'game');
  end loop;
  return g;
end $$;

-- Her saniye cron tarafından (ve yedek olarak tarayıcılardan) çağrılır
create or replace function app.tick() returns void language plpgsql as $$
declare
  g public.games;
  a bigint;
begin
  g := app.current_game();
  if g.id is null then return; end if;
  if g.status = 'running' and g.next_draw_ms is not null and g.next_draw_ms <= app.now_ms() then
    select * into g from public.games where id = g.id for update skip locked;
    if g.id is not null and g.status = 'running' and g.next_draw_ms <= app.now_ms() then
      perform app.draw_one(g.id);
    end if;
  elsif g.status = 'waiting' and g.scheduled_ms is not null and g.scheduled_ms <= app.now_ms() then
    select * into g from public.games where id = g.id for update skip locked;
    if g.id is null or g.status <> 'waiting' or g.scheduled_ms is null or g.scheduled_ms > app.now_ms() then
      return;
    end if;
    if exists (select 1 from app.purchases where game_id = g.id and status = 'paid') then
      perform app.start_game();
    else
      update public.games set scheduled_ms = null where id = g.id;
      for a in select id from app.users where role = 'admin' loop
        perform app.notify(a, 'Planlanan oyun başlatılamadı: ödemesi tamamlanmış kart yok.', 'error');
      end loop;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Site API'si (public.tb_*). Hepsi SECURITY DEFINER: tablolara yalnızca
-- bu fonksiyonlar üzerinden, kurallar denetlenerek erişilir.
-- ---------------------------------------------------------------------

-- ----- kimlik doğrulama -----

create or replace function public.tb_register(p_name text, p_username text, p_password text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_user text := btrim(coalesce(p_username, ''));
  u app.users;
  first boolean;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'Ad Soyad 2-40 karakter olmalı.';
  end if;
  if v_user !~ '^[a-zA-Z0-9_.]{3,20}$' then
    raise exception 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ ve .).';
  end if;
  if char_length(coalesce(p_password, '')) < 6 then
    raise exception 'Şifre en az 6 karakter olmalı.';
  end if;
  lock table app.users in share row exclusive mode;
  if exists (select 1 from app.users where lower(username) = lower(v_user)) then
    raise exception 'Bu kullanıcı adı zaten alınmış.';
  end if;
  first := not exists (select 1 from app.users);
  insert into app.users (username, name, pass_hash, role)
  values (v_user, v_name, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), case when first then 'admin' else 'user' end)
  returning * into u;
  perform app.notify(u.id, format('Hoş geldin %s! Kartını seç, şansını dene.', u.name), 'info');
  if first then
    perform app.notify(u.id, 'İlk kayıtlı kullanıcı olduğunuz için yönetici yetkisi verildi.', 'info');
  end if;
  return jsonb_build_object('token', app.new_session(u.id, true), 'user', app.user_json(u));
end $$;

create or replace function public.tb_login(p_username text, p_password text, p_remember boolean default true)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users;
  v_ip text := coalesce(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), '');
  v_key text := v_ip || '|' || lower(btrim(coalesce(p_username, '')));
  a app.login_attempts;
begin
  select * into a from app.login_attempts where key = v_key;
  if a.key is not null and a.until > now() and a.count >= 8 then
    raise exception 'Çok fazla hatalı deneme. Lütfen 10 dakika sonra tekrar deneyin.';
  end if;
  select * into u from app.users where lower(username) = lower(btrim(coalesce(p_username, '')));
  if u.id is null or u.pass_hash <> extensions.crypt(coalesce(p_password, ''), u.pass_hash) then
    insert into app.login_attempts (key, count, until) values (v_key, 1, now() + interval '10 minutes')
    on conflict (key) do update set
      count = case when app.login_attempts.until < now() then 1 else app.login_attempts.count + 1 end,
      until = case when app.login_attempts.until < now() then now() + interval '10 minutes' else app.login_attempts.until end;
    -- hatalı deneme kaydı kalıcı olsun diye hata yerine sonuç döndürülür
    return jsonb_build_object('error', 'Kullanıcı adı veya şifre hatalı.');
  end if;
  if u.blocked then
    return jsonb_build_object('error', 'Hesabınız askıya alınmış. Yöneticiyle iletişime geçin.');
  end if;
  delete from app.login_attempts where key = v_key or until < now() - interval '1 day';
  return jsonb_build_object('token', app.new_session(u.id, coalesce(p_remember, true)), 'user', app.user_json(u));
end $$;

create or replace function public.tb_logout(p_token text)
returns jsonb language sql security definer set search_path = app, public, extensions as $$
  delete from app.sessions where token_hash = app.token_hash(p_token);
  select jsonb_build_object('ok', true);
$$;

create or replace function public.tb_me(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users;
begin
  select * into u from app.token_user(p_token);
  if u.id is null then
    return jsonb_build_object('user', null);
  end if;
  return jsonb_build_object('user', app.user_json(u),
    'unread', (select count(*) from app.notifications where user_id = u.id and not read));
end $$;

create or replace function public.tb_update_me(p_token text, p_name text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    raise exception 'Ad Soyad 2-40 karakter olmalı.';
  end if;
  update app.users set name = v_name where id = u.id returning * into u;
  return jsonb_build_object('user', app.user_json(u));
end $$;

create or replace function public.tb_change_password(p_token text, p_current text, p_next text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
begin
  if u.pass_hash <> extensions.crypt(coalesce(p_current, ''), u.pass_hash) then
    raise exception 'Mevcut şifre hatalı.';
  end if;
  if char_length(coalesce(p_next, '')) < 6 then
    raise exception 'Yeni şifre en az 6 karakter olmalı.';
  end if;
  update app.users set pass_hash = extensions.crypt(p_next, extensions.gen_salt('bf', 10)) where id = u.id;
  delete from app.sessions where user_id = u.id and token_hash <> app.token_hash(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- ----- oyun (herkese açık) -----

create or replace function public.tb_state()
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  g public.games := app.current_game();
begin
  if g.id is null then
    g := app.create_game();
  end if;
  return app.state_json(g);
end $$;

create or replace function public.tb_deck()
returns jsonb language sql security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('gameId', g.id,
    'cards', coalesce((select jsonb_agg(grid order by card_no) from app.game_cards where game_id = g.id), '[]'))
  from app.current_game() g
$$;

create or replace function public.tb_tick()
returns void language sql security definer set search_path = app, public, extensions as $$
  select app.tick();
$$;

create or replace function public.tb_winners(p_range text default 'week')
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_range text := case when p_range in ('week', 'month', 'all') then p_range else 'week' end;
  v_since timestamptz;
begin
  v_since := case v_range
    when 'week' then date_trunc('week', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'
    when 'month' then date_trunc('month', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'
    else '-infinity'::timestamptz end;
  return jsonb_build_object(
    'range', v_range,
    'list', coalesce((
      select jsonb_agg(x order by (x ->> 'total')::numeric desc)
      from (
        select jsonb_build_object('userId', w.user_id, 'total', sum(w.amount), 'count', count(*),
          'tombala', count(*) filter (where w.prize = 'tombala'),
          'name', coalesce(max(u.name), '?'), 'username', coalesce(max(u.username), '?')) x
        from app.wins w left join app.users u on u.id = w.user_id
        where w.at >= v_since
        group by w.user_id
        order by sum(w.amount) desc
        limit 50
      ) t), '[]'),
    'recent', coalesce((
      select jsonb_agg(x order by (x ->> 'id')::bigint desc)
      from (
        select jsonb_build_object('id', w.id, 'gameId', w.game_id, 'userId', w.user_id, 'cardNo', w.card_no,
          'prize', w.prize, 'amount', w.amount, 'at', app.ms(w.at), 'name', coalesce(u.name, '?'),
          'label', app.prize_label(w.prize)) x
        from app.wins w left join app.users u on u.id = w.user_id
        order by w.id desc
        limit 15
      ) t), '[]'));
end $$;

-- ----- oyuncu -----

create or replace function public.tb_my_cards(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
  g public.games := app.current_game();
begin
  return jsonb_build_object(
    'gameId', g.id,
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object('cardNo', gc.card_no, 'grid', gc.grid) order by gc.card_no)
      from app.game_cards gc
      where gc.game_id = g.id and gc.card_no in (
        select unnest(cards) from app.purchases where game_id = g.id and user_id = u.id and status = 'paid')
    ), '[]'),
    'purchases', coalesce((
      select jsonb_agg(app.purchase_json(p) order by p.id desc)
      from app.purchases p where p.game_id = g.id and p.user_id = u.id
    ), '[]'));
end $$;

create or replace function public.tb_request_cards(p_token text, p_cards int[])
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
  g public.games;
  s app.settings;
  v_cards int[];
  v_conflicts int[];
  p app.purchases;
  a bigint;
begin
  g := app.lock_current();
  if g.status <> 'waiting' then
    raise exception 'Kart satışı şu an kapalı. Oyun başladı veya sona erdi.';
  end if;
  select * into s from app.settings where id = 1;
  select array_agg(distinct c order by c) into v_cards from unnest(coalesce(p_cards, '{}')) c;
  if v_cards is null then
    raise exception 'En az bir kart seçmelisiniz.';
  end if;
  if exists (select 1 from unnest(v_cards) c where c is null or c < 1 or c > 100) then
    raise exception 'Geçersiz kart numarası.';
  end if;
  if cardinality(v_cards) > s.max_cards_per_request then
    raise exception 'Tek seferde en fazla % kart alabilirsiniz.', s.max_cards_per_request;
  end if;
  select array_agg(c order by c) into v_conflicts from unnest(v_cards) c
    where c in (select unnest(cards) from app.purchases
                where game_id = g.id and status in ('pending', 'awaiting_payment', 'paid'));
  if v_conflicts is not null then
    raise exception 'Bu kartlar artık müsait değil: %', array_to_string(v_conflicts, ', ');
  end if;
  insert into app.purchases (game_id, user_id, cards, unit_price, total, status, approved_at)
  values (g.id, u.id, v_cards, s.card_price, round(s.card_price * cardinality(v_cards), 2),
          case when s.auto_approve then 'awaiting_payment' else 'pending' end,
          case when s.auto_approve then now() end)
  returning * into p;
  perform app.refresh_game(g.id);
  return jsonb_build_object('purchase', app.purchase_json(p));
end $$;

create or replace function public.tb_purchase(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
  p app.purchases;
begin
  select * into p from app.purchases where id = p_id;
  if p.id is null or (p.user_id <> u.id and u.role <> 'admin') then
    raise exception 'Talep bulunamadı.';
  end if;
  return jsonb_build_object('purchase', app.purchase_json(p),
    'paymentInfo', (select payment_info from app.settings where id = 1), 'balance', u.balance);
end $$;

create or replace function public.tb_pay(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
  g public.games;
  p app.purchases;
begin
  g := app.lock_current();
  select * into p from app.purchases where id = p_id for update;
  if p.id is null or p.user_id <> u.id then raise exception 'Talep bulunamadı.'; end if;
  if p.status <> 'awaiting_payment' then raise exception 'Bu talep ödeme beklemiyor.'; end if;
  if p.game_id <> g.id or g.status <> 'waiting' then raise exception 'Oyun başladığı için ödeme yapılamaz.'; end if;
  select * into u from app.users where id = u.id for update;
  if u.balance < p.total then raise exception 'Bakiyeniz yetersiz.'; end if;
  update app.users set balance = balance - p.total where id = u.id returning * into u;
  update app.purchases set status = 'paid', paid_at = now(), paid_via = 'balance',
    approved_at = coalesce(approved_at, now()) where id = p.id returning * into p;
  perform app.notify(u.id, format('Ödemeniz alındı! %s kartınız oyuna hazır: %s',
    cardinality(p.cards), array_to_string(p.cards, ', ')), 'success', p.id);
  perform app.refresh_game(g.id);
  return jsonb_build_object('purchase', app.purchase_json(p), 'balance', u.balance);
end $$;

create or replace function public.tb_cancel_purchase(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
  g public.games;
  p app.purchases;
begin
  g := app.lock_current();
  select * into p from app.purchases where id = p_id for update;
  if p.id is null or p.user_id <> u.id then raise exception 'Talep bulunamadı.'; end if;
  if p.status not in ('pending', 'awaiting_payment') then raise exception 'Bu talep iptal edilemez.'; end if;
  update app.purchases set status = 'cancelled', closed_at = now() where id = p.id returning * into p;
  perform app.refresh_game(p.game_id);
  return jsonb_build_object('purchase', app.purchase_json(p));
end $$;

create or replace function public.tb_history(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
begin
  return jsonb_build_object(
    'games', coalesce((
      select jsonb_agg(x order by (x ->> 'gameId')::bigint desc)
      from (
        select jsonb_build_object(
          'gameId', g.id, 'status', g.status, 'createdAt', g.created_ms, 'startedAt', g.started_ms,
          'endedAt', g.ended_ms, 'drawnCount', cardinality(g.drawn), 'drawn', to_jsonb(g.drawn),
          'cards', coalesce((
            select jsonb_agg(jsonb_build_object('cardNo', gc.card_no, 'grid', gc.grid) order by gc.card_no)
            from app.game_cards gc where gc.game_id = g.id and gc.card_no in (
              select unnest(cards) from app.purchases where game_id = g.id and user_id = u.id and status = 'paid')), '[]'),
          'spent', coalesce((select sum(total) from app.purchases where game_id = g.id and user_id = u.id and status = 'paid'), 0),
          'refunded', exists (select 1 from app.purchases where game_id = g.id and user_id = u.id and refunded),
          'wins', coalesce((
            select jsonb_agg(jsonb_build_object('prize', w.prize, 'label', app.prize_label(w.prize),
              'cardNo', w.card_no, 'amount', w.amount) order by w.id)
            from app.wins w where w.game_id = g.id and w.user_id = u.id), '[]'),
          'requests', coalesce((
            select jsonb_agg(jsonb_build_object('id', p.id, 'status', p.status, 'cards', to_jsonb(p.cards),
              'total', p.total, 'createdAt', app.ms(p.created_at)) order by p.id)
            from app.purchases p where p.game_id = g.id and p.user_id = u.id), '[]')
        ) x
        from public.games g
        where g.id in (select game_id from app.purchases where user_id = u.id)
        order by g.id desc
        limit 30
      ) t), '[]'),
    'stats', jsonb_build_object(
      'games', (select count(distinct game_id) from app.purchases where user_id = u.id and status = 'paid' and not refunded),
      'cards', coalesce((select sum(cardinality(cards)) from app.purchases where user_id = u.id and status = 'paid' and not refunded), 0),
      'spent', coalesce((select sum(total) from app.purchases where user_id = u.id and status = 'paid' and not refunded), 0),
      'won', coalesce((select sum(amount) from app.wins where user_id = u.id), 0),
      'wins', (select count(*) from app.wins where user_id = u.id)));
end $$;

create or replace function public.tb_notifications(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'userId', n.user_id, 'text', n.text, 'type', n.type,
      'at', app.ms(n.at), 'read', n.read) order by n.id desc)
    from (select * from app.notifications where user_id = u.id order by id desc limit 50) n), '[]'));
end $$;

create or replace function public.tb_notifications_read(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users := app.require_user(p_token);
begin
  update app.notifications set read = true where user_id = u.id and not read;
  return jsonb_build_object('ok', true);
end $$;

-- Oturum açık tarayıcıların birkaç saniyede bir çağırdığı özet:
-- bakiye, yeni bildirimler, talep durumları ve (yöneticiye) bekleyen talepler.
create or replace function public.tb_poll(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  u app.users;
  g public.games := app.current_game();
  res jsonb;
begin
  select * into u from app.token_user(p_token);
  if u.id is null then
    raise exception 'Oturum açmanız gerekiyor.' using errcode = 'TB401';
  end if;
  res := jsonb_build_object(
    'user', app.user_json(u),
    'unread', (select count(*) from app.notifications where user_id = u.id and not read),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'userId', n.user_id, 'text', n.text, 'type', n.type,
        'at', app.ms(n.at), 'read', n.read) order by n.id)
      from (select * from app.notifications where user_id = u.id order by id desc limit 15) n), '[]'),
    'purchases', coalesce((
      select jsonb_agg(app.purchase_json(p) order by p.id)
      from app.purchases p
      where p.user_id = u.id and (p.game_id = g.id or p.updated_at > now() - interval '5 minutes')), '[]'),
    'serverNow', app.now_ms());
  if u.role = 'admin' then
    res := res || jsonb_build_object('admin', jsonb_build_object(
      'pending', coalesce((
        select jsonb_agg(app.purchase_json(p) order by p.id)
        from (select * from app.purchases where status = 'pending' order by id desc limit 20) p), '[]'),
      'version', concat_ws('|',
        (select count(*) from app.purchases), (select max(updated_at) from app.purchases),
        (select count(*) from app.users), (select max(updated_at) from app.users))));
  end if;
  return res;
end $$;

-- ----- yönetici -----

create or replace function public.tb_admin_overview(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
  g public.games := app.current_game();
begin
  return jsonb_build_object(
    'state', app.state_json(g),
    'stats', jsonb_build_object(
      'users', (select count(*) from app.users),
      'pending', (select count(*) from app.purchases where game_id = g.id and status = 'pending'),
      'awaiting', (select count(*) from app.purchases where game_id = g.id and status = 'awaiting_payment'),
      'soldCards', g.sold_count,
      'revenue', coalesce((select sum(total) from app.purchases where game_id = g.id and status = 'paid'), 0),
      'totalPaidOut', coalesce((select sum(amount) from app.wins), 0),
      'gamesPlayed', (select count(*) from public.games where status = 'finished')),
    'lastGames', coalesce((
      select jsonb_agg(x order by (x ->> 'id')::bigint desc)
      from (
        select jsonb_build_object('id', x.id, 'status', x.status, 'startedAt', x.started_ms, 'endedAt', x.ended_ms,
          'drawn', cardinality(x.drawn), 'pool', x.pool,
          'tombala', case when jsonb_typeof(x.prizes -> 'tombala') = 'object' then (
            select string_agg(distinct w ->> 'name', ', ') from jsonb_array_elements(x.prizes -> 'tombala' -> 'winners') w)
          end) x
        from public.games x order by x.id desc limit 6
      ) t), '[]'));
end $$;

create or replace function public.tb_admin_game(p_token text, p_action text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
  g public.games;
  p app.purchases;
  num int;
begin
  if p_action = 'start' then
    g := app.start_game();
  elsif p_action = 'pause' then
    g := app.lock_current();
    if g.status <> 'running' then raise exception 'Oyun şu an çalışmıyor.'; end if;
    update public.games set active_ms = app.elapsed_ms(g), status = 'paused', resumed_ms = null, next_draw_ms = null
    where id = g.id returning * into g;
  elsif p_action = 'draw' then
    g := app.lock_current();
    num := app.draw_one(g.id);
    return jsonb_build_object('number', num);
  elsif p_action = 'cancel' then
    g := app.lock_current();
    if g.status not in ('waiting', 'running', 'paused') then raise exception 'Bu oyun iptal edilemez.'; end if;
    perform app.cancel_open_requests(g.id, 'Oyun iptal edildi.');
    for p in
      update app.purchases set refunded = true where game_id = g.id and status = 'paid' and not refunded returning *
    loop
      update app.users set balance = balance + p.total where id = p.user_id;
      perform app.notify(p.user_id, format('Oyun iptal edildi. %s bakiyenize iade edildi.', app.fmt_tl(p.total)), 'info');
    end loop;
    update public.games set active_ms = app.elapsed_ms(g), status = 'cancelled', resumed_ms = null,
      next_draw_ms = null, ended_ms = app.now_ms()
    where id = g.id;
    perform app.refresh_game(g.id);
  elsif p_action = 'new' then
    g := app.lock_current();
    if g.status not in ('finished', 'cancelled') then
      raise exception 'Mevcut oyun bitmeden yeni oyun oluşturulamaz.';
    end if;
    g := app.create_game();
  else
    raise exception 'Geçersiz işlem.';
  end if;
  return app.state_json(app.current_game());
end $$;

create or replace function public.tb_admin_schedule(p_token text, p_at bigint)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
  g public.games := app.lock_current();
begin
  if g.status <> 'waiting' then raise exception 'Sadece bekleyen oyun için tarih belirlenebilir.'; end if;
  if p_at is not null and p_at < app.now_ms() - 60000 then raise exception 'Geçerli, ileri bir tarih seçin.'; end if;
  update public.games set scheduled_ms = p_at where id = g.id returning * into g;
  return app.state_json(g);
end $$;

create or replace function public.tb_admin_purchases(p_token text, p_status text default '')
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(app.purchase_json(p) order by p.id desc)
    from (
      select * from app.purchases
      where coalesce(p_status, '') = ''
         or (p_status = 'open' and status in ('pending', 'awaiting_payment'))
         or status = p_status
      order by id desc limit 200
    ) p), '[]'));
end $$;

create or replace function public.tb_admin_purchase_action(p_token text, p_id bigint, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
  g public.games := app.lock_current();
  p app.purchases;
begin
  select * into p from app.purchases where id = p_id for update;
  if p.id is null then raise exception 'Talep bulunamadı.'; end if;
  if p_action = 'approve' then
    if p.status <> 'pending' then raise exception 'Bu talep onay beklemiyor.'; end if;
    update app.purchases set status = 'awaiting_payment', approved_at = now() where id = p.id returning * into p;
    perform app.notify(p.user_id, format('%s adet kart talebiniz onaylandı. Ödeme bekleniyor (%s).',
      cardinality(p.cards), app.fmt_tl(p.total)), 'info', p.id);
  elsif p_action = 'reject' then
    if p.status not in ('pending', 'awaiting_payment') then raise exception 'Bu talep artık reddedilemez.'; end if;
    update app.purchases set status = 'rejected', reason = nullif(left(btrim(coalesce(p_reason, '')), 200), ''),
      closed_at = now() where id = p.id returning * into p;
    perform app.notify(p.user_id, 'Kart talebiniz reddedildi.' || coalesce(' Sebep: ' || p.reason, ''), 'error', p.id);
  elsif p_action = 'confirm' then
    if p.status not in ('pending', 'awaiting_payment') then raise exception 'Bu talep ödeme beklemiyor.'; end if;
    if p.game_id <> g.id or g.status <> 'waiting' then raise exception 'Oyun başladığı için bu talep onaylanamaz.'; end if;
    update app.purchases set status = 'paid', paid_at = now(), paid_via = 'manual',
      approved_at = coalesce(approved_at, now()) where id = p.id returning * into p;
    perform app.notify(p.user_id, format('Ödemeniz alındı! %s kartınız oyuna hazır: %s',
      cardinality(p.cards), array_to_string(p.cards, ', ')), 'success', p.id);
  elsif p_action = 'cancel' then
    -- Onaylanmış (ödenmiş) talebi oyun başlamadan iptal et; kartlar tekrar satışa açılır
    if p.status not in ('paid', 'pending', 'awaiting_payment') then raise exception 'Bu talep iptal edilemez.'; end if;
    if p.status = 'paid' and (p.game_id <> g.id or g.status <> 'waiting') then
      raise exception 'Oyun başladıktan sonra onaylanmış kart iptal edilemez. Gerekirse oyunu iptal edin.';
    end if;
    if p.status = 'paid' and p.paid_via = 'balance' then
      update app.users set balance = balance + p.total where id = p.user_id;
      update app.purchases set refunded = true where id = p.id;
    end if;
    update app.purchases set status = 'cancelled', closed_at = now(),
      reason = coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'Yönetici tarafından iptal edildi.')
    where id = p.id returning * into p;
    perform app.notify(p.user_id, format('%s numaralı kart%s yönetici tarafından iptal edildi.%s',
      array_to_string(p.cards, ', '), case when cardinality(p.cards) > 1 then 'lar' else '' end,
      case when p.refunded then format(' %s bakiyenize iade edildi.', app.fmt_tl(p.total)) else '' end), 'error', p.id);
  else
    raise exception 'Geçersiz işlem.';
  end if;
  perform app.refresh_game(p.game_id);
  return jsonb_build_object('purchase', app.purchase_json(p));
end $$;

create or replace function public.tb_admin_users(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
begin
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(app.user_json(u) || jsonb_build_object(
      'won', coalesce((select sum(amount) from app.wins w where w.user_id = u.id), 0),
      'cards', coalesce((select sum(cardinality(cards)) from app.purchases p where p.user_id = u.id and p.status = 'paid'), 0))
      order by u.id)
    from app.users u), '[]'));
end $$;

create or replace function public.tb_admin_update_user(p_token text, p_id bigint, p_balance_delta numeric default null,
  p_role text default null, p_blocked boolean default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
  u app.users;
begin
  select * into u from app.users where id = p_id for update;
  if u.id is null then raise exception 'Kullanıcı bulunamadı.'; end if;
  if p_balance_delta is not null then
    if p_balance_delta = 0 then raise exception 'Geçerli bir tutar girin.'; end if;
    if u.balance + p_balance_delta < 0 then raise exception 'Bakiye eksiye düşemez.'; end if;
    update app.users set balance = balance + round(p_balance_delta, 2) where id = u.id returning * into u;
    perform app.notify(u.id, case when p_balance_delta > 0
      then format('Bakiyenize %s eklendi.', app.fmt_tl(round(p_balance_delta, 2)))
      else format('Bakiyenizden %s düşüldü.', app.fmt_tl(round(abs(p_balance_delta), 2))) end, 'info');
  end if;
  if p_role is not null then
    if p_role not in ('admin', 'user') then raise exception 'Geçersiz rol.'; end if;
    if u.id = a.id and p_role <> 'admin' then raise exception 'Kendi yönetici yetkinizi kaldıramazsınız.'; end if;
    update app.users set role = p_role where id = u.id returning * into u;
  end if;
  if p_blocked is not null then
    if u.id = a.id then raise exception 'Kendinizi engelleyemezsiniz.'; end if;
    update app.users set blocked = p_blocked where id = u.id returning * into u;
    if p_blocked then delete from app.sessions where user_id = u.id; end if;
  end if;
  return jsonb_build_object('user', app.user_json(u));
end $$;

create or replace function public.tb_admin_reset_password(p_token text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
  v_pass text := left(translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=lIO0', 'xyzkmnp'), 8);
begin
  update app.users set pass_hash = extensions.crypt(v_pass, extensions.gen_salt('bf', 10)) where id = p_id;
  if not found then raise exception 'Kullanıcı bulunamadı.'; end if;
  delete from app.sessions where user_id = p_id;
  return jsonb_build_object('password', v_pass);
end $$;

create or replace function app.settings_json() returns jsonb language sql stable as $$
  select jsonb_build_object('cardPrice', s.card_price, 'drawIntervalSec', s.draw_interval_sec,
    'poolMode', s.pool_mode, 'payoutPercent', s.payout_percent, 'fixedPool', s.fixed_pool,
    'prizeSplit', s.prize_split, 'autoApprove', s.auto_approve,
    'maxCardsPerRequest', s.max_cards_per_request, 'paymentInfo', s.payment_info)
  from app.settings s where s.id = 1
$$;

create or replace function public.tb_admin_settings(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
begin
  return jsonb_build_object('settings', app.settings_json());
end $$;

create or replace function app.num_in(p jsonb, k text, lo numeric, hi numeric, label text) returns numeric
language plpgsql immutable as $$
declare
  v numeric;
begin
  begin
    v := (p ->> k)::numeric;
  exception when others then
    v := null;
  end;
  if v is null or v < lo or v > hi then
    raise exception '% % ile % arasında olmalı.', label, lo, hi;
  end if;
  return v;
end $$;

create or replace function public.tb_admin_update_settings(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  a app.users := app.require_admin(p_token);
  s app.settings;
  v_split jsonb;
  v_sum numeric;
begin
  select * into s from app.settings where id = 1 for update;
  if p ? 'cardPrice' then s.card_price := round(app.num_in(p, 'cardPrice', 1, 100000, 'Kart bedeli'), 2); end if;
  if p ? 'drawIntervalSec' then s.draw_interval_sec := round(app.num_in(p, 'drawIntervalSec', 2, 120, 'Çekiliş aralığı')); end if;
  if p ? 'poolMode' then
    if p ->> 'poolMode' not in ('sales', 'fixed') then raise exception 'Geçersiz havuz modu.'; end if;
    s.pool_mode := p ->> 'poolMode';
  end if;
  if p ? 'payoutPercent' then s.payout_percent := app.num_in(p, 'payoutPercent', 0, 100, 'Havuz oranı'); end if;
  if p ? 'fixedPool' then s.fixed_pool := round(app.num_in(p, 'fixedPool', 0, 100000000, 'Sabit havuz'), 2); end if;
  if p ? 'maxCardsPerRequest' then
    s.max_cards_per_request := round(app.num_in(p, 'maxCardsPerRequest', 1, 100, 'Talep başına kart'));
  end if;
  if p ? 'autoApprove' then s.auto_approve := coalesce((p ->> 'autoApprove')::boolean, false); end if;
  if p ? 'paymentInfo' then s.payment_info := left(coalesce(p ->> 'paymentInfo', ''), 600); end if;
  if p ? 'prizeSplit' then
    v_split := jsonb_build_object(
      'cinko1', app.num_in(p -> 'prizeSplit', 'cinko1', 0, 100, '1. Çinko oranı'),
      'cinko2', app.num_in(p -> 'prizeSplit', 'cinko2', 0, 100, '2. Çinko oranı'),
      'tombala', app.num_in(p -> 'prizeSplit', 'tombala', 0, 100, 'Tombala oranı'));
    v_sum := (v_split ->> 'cinko1')::numeric + (v_split ->> 'cinko2')::numeric + (v_split ->> 'tombala')::numeric;
    if abs(v_sum - 100) > 0.001 then raise exception 'Ödül dağılımı toplamı %%100 olmalı.'; end if;
    s.prize_split := v_split;
  end if;
  update app.settings set card_price = s.card_price, draw_interval_sec = s.draw_interval_sec,
    pool_mode = s.pool_mode, payout_percent = s.payout_percent, fixed_pool = s.fixed_pool,
    max_cards_per_request = s.max_cards_per_request, auto_approve = s.auto_approve,
    payment_info = s.payment_info, prize_split = s.prize_split
  where id = 1;
  perform app.refresh_game((select max(id) from public.games));
  return jsonb_build_object('settings', app.settings_json());
end $$;

-- ---------------------------------------------------------------------
-- İzinler
-- ---------------------------------------------------------------------

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;

alter table public.games enable row level security;
revoke all on table public.games from public, anon, authenticated;
grant select on table public.games to anon, authenticated;
drop policy if exists "games herkese acik" on public.games;
create policy "games herkese acik" on public.games for select to anon, authenticated using (true);

do $$
declare
  f text;
begin
  for f in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'tb\_%'
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

-- Realtime: oyun satırındaki değişiklikleri izleyicilere yayınla
alter table public.games replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games') then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;

-- Bekleyen oyunun kartları eski (boşluklu 3x9) düzendeyse yeni düzene çevir.
-- Kart numaraları ve alınmış kartlar aynı kalır; yalnızca kartların üzerindeki sayılar yenilenir.
do $$
declare
  g public.games;
  v_grid jsonb;
  v_seen text[] := '{}';
  n int;
begin
  select * into g from public.games order by id desc limit 1;
  if g.id is not null and g.status = 'waiting'
     and exists (select 1 from app.game_cards where game_id = g.id and jsonb_array_length(grid -> 0) <> 5) then
    for n in 1..100 loop
      loop
        v_grid := app.generate_card();
        exit when not (v_grid::text = any (v_seen));
      end loop;
      v_seen := v_seen || v_grid::text;
      update app.game_cards
        set grid = v_grid, r1 = app.row_nums(v_grid, 0), r2 = app.row_nums(v_grid, 1), r3 = app.row_nums(v_grid, 2)
      where game_id = g.id and card_no = n;
    end loop;
  end if;
end $$;

-- İlk oyunu oluştur
do $$
begin
  if not exists (select 1 from public.games) then
    perform app.create_game();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Otomatik çekiliş: pg_cron her saniye app.tick() çalıştırır.
-- (pg_cron kurulamazsa oyun yine çalışır: sayfayı izleyen tarayıcılar
--  zamanı gelen topu yedek olarak tetikler.)
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('tombala-tick', '1 seconds', 'select app.tick()');
  perform cron.schedule('tombala-cron-temizlik', '*/10 * * * *',
    $c$delete from cron.job_run_details where end_time < now() - interval '1 hour'$c$);
exception when others then
  raise warning 'pg_cron kurulamadı (sorun değil, yedek mekanizma çalışır): %', sqlerrm;
end $$;
