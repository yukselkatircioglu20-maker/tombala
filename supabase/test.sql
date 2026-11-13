-- Yerel test: psql ile çalıştırın. Her şeyi bir işlem içinde yapar ve geri alır.
-- psql -d tombala -v ON_ERROR_STOP=1 -f supabase/test.sql
begin;
set local role anon;

do $$
declare
  r jsonb; ta text; tu text; ty text; p1 bigint; p2 bigint; p3 bigint;
  g jsonb; total numeric; bal numeric; i int; failed boolean;
begin
  -- kayıt: ilk kullanıcı yönetici olur
  r := public.tb_register('Yönetici', 'admin_t', 'secret12');
  ta := r ->> 'token';
  -- (test veritabanında başka kullanıcı varsa ilk olmayabilir)
  r := public.tb_register('Ahmet Yılmaz', 'ahmet_t', 'secret12');
  tu := r ->> 'token';
  assert r -> 'user' ->> 'role' = 'user', 'ikinci kullanıcı normal kullanıcı';
  r := public.tb_register('Ayşe Demir', 'ayse_t', 'secret12');
  ty := r ->> 'token';

  begin
    perform public.tb_register('Başka', 'AHMET_T', 'secret12');
    raise exception 'beklenmedik başarı';
  exception when others then
    assert sqlerrm like '%zaten alınmış%', 'kullanıcı adı benzersiz: ' || sqlerrm;
  end;

  -- giriş
  r := public.tb_login('ahmet_t', 'yanlis', true);
  assert r ? 'error', 'hatalı şifre reddedilir';
  r := public.tb_login('AHMET_T', 'secret12', false);
  assert r ? 'token', 'büyük/küçük harf duyarsız giriş';
  assert (public.tb_me(r ->> 'token') -> 'user' ->> 'username') = 'ahmet_t';
  assert (public.tb_me('gecersiz') -> 'user') = 'null'::jsonb;

  -- normal kullanıcı admin işlemi yapamaz
  begin
    perform public.tb_admin_overview(tu);
    raise exception 'beklenmedik başarı';
  exception when others then
    assert sqlstate = 'TB403', 'admin yetkisi kontrolü: ' || sqlstate;
  end;

  -- yönetici yap (test DB'sinde ilk kullanıcı olmayabilir)
  set local role postgres;
  update app.users set role = 'admin' where username = 'admin_t';
  set local role anon;

  -- yeni temiz oyun
  g := public.tb_state();
  if g ->> 'status' <> 'waiting' then
    if g ->> 'status' in ('running', 'paused') then perform public.tb_admin_game(ta, 'cancel'); end if;
    perform public.tb_admin_game(ta, 'new');
  end if;

  r := public.tb_request_cards(tu, array[1, 2, 3]);
  p1 := (r -> 'purchase' ->> 'id')::bigint;
  assert r -> 'purchase' ->> 'status' = 'pending';
  begin
    perform public.tb_request_cards(ty, array[3, 4]);
    raise exception 'beklenmedik başarı';
  exception when others then
    assert sqlerrm like '%müsait değil: 3%', 'çakışan kart: ' || sqlerrm;
  end;
  r := public.tb_request_cards(ty, array[4, 5]);
  p2 := (r -> 'purchase' ->> 'id')::bigint;
  assert (public.tb_state() -> 'taken') = '[1,2,3,4,5]'::jsonb, 'dolu kartlar yayınlanır';

  begin
    perform public.tb_admin_game(ta, 'start');
    raise exception 'beklenmedik başarı';
  exception when others then
    assert sqlerrm like '%Ödemesi tamamlanmış kart olmadan%', sqlerrm;
  end;

  -- poll: yöneticiye bekleyen talepler görünür
  r := public.tb_poll(ta);
  assert jsonb_array_length(r -> 'admin' -> 'pending') >= 2, 'admin bekleyen talepleri görür';

  perform public.tb_admin_purchase_action(ta, p1, 'approve');
  begin
    perform public.tb_pay(tu, p1);
    raise exception 'beklenmedik başarı';
  exception when others then
    assert sqlerrm like '%yetersiz%', sqlerrm;
  end;
  r := public.tb_admin_users(ta);
  perform public.tb_admin_update_user(ta, (select (x ->> 'id')::bigint from jsonb_array_elements(r -> 'items') x where x ->> 'username' = 'ahmet_t'), 1000);
  r := public.tb_pay(tu, p1);
  assert r -> 'purchase' ->> 'status' = 'paid';
  assert (r ->> 'balance')::numeric = 700, 'bakiyeden düşüldü';
  r := public.tb_admin_purchase_action(ta, p2, 'confirm');
  assert r -> 'purchase' ->> 'status' = 'paid';

  r := public.tb_request_cards(ty, array[50]);
  p3 := (r -> 'purchase' ->> 'id')::bigint;

  g := public.tb_admin_game(ta, 'start');
  assert g ->> 'status' = 'running';
  assert (g ->> 'pool')::numeric = 400, 'havuz = 5 kart x 100 x %80 → ' || (g ->> 'pool');
  assert (g -> 'prizeAmounts' ->> 'tombala')::numeric = 200;
  r := public.tb_purchase(ty, p3);
  assert r -> 'purchase' ->> 'status' = 'cancelled', 'açık talep oyun başlayınca iptal';
  begin
    perform public.tb_request_cards(ty, array[60]);
    raise exception 'beklenmedik başarı';
  exception when others then
    assert sqlerrm like '%satışı şu an kapalı%', sqlerrm;
  end;

  -- kartlarım
  r := public.tb_my_cards(tu);
  assert jsonb_array_length(r -> 'cards') = 3;

  perform public.tb_admin_game(ta, 'pause');
  for i in 1..95 loop
    failed := false;
    begin
      perform public.tb_admin_game(ta, 'draw');
    exception when others then
      failed := true;
    end;
    exit when failed;
  end loop;
  g := public.tb_state();
  assert g ->> 'status' = 'finished', 'oyun bitti: ' || (g ->> 'status');
  assert jsonb_typeof(g -> 'prizes' -> 'cinko1') = 'object';
  assert jsonb_typeof(g -> 'prizes' -> 'cinko2') = 'object';
  assert jsonb_typeof(g -> 'prizes' -> 'tombala') = 'object';
  assert (g -> 'prizes' -> 'cinko1' ->> 'drawIndex')::int <= (g -> 'prizes' -> 'cinko2' ->> 'drawIndex')::int;
  assert (g -> 'prizes' -> 'cinko2' ->> 'drawIndex')::int <= (g -> 'prizes' -> 'tombala' ->> 'drawIndex')::int;

  select sum((w ->> 'amount')::numeric) into total
  from jsonb_each(g -> 'prizes') e, jsonb_array_elements(e.value -> 'winners') w;
  assert total <= 400, 'dağıtılan ödül havuzu aşmaz';
  set local role postgres;
  select sum(balance) into bal from app.users where username in ('ahmet_t', 'ayse_t');
  set local role anon;
  assert abs(bal - (700 + total)) < 0.01, 'bakiyeler tutarlı';

  r := public.tb_winners('week');
  assert jsonb_array_length(r -> 'list') >= 1;
  r := public.tb_history(tu);
  assert (r -> 'stats' ->> 'cards')::int = 3;
  r := public.tb_admin_overview(ta);
  r := public.tb_notifications(tu);
  assert jsonb_array_length(r -> 'items') >= 3;

  -- tabloların doğrudan değiştirilemediğini doğrula
  begin
    update public.games set pool = 999999;
    raise exception 'beklenmedik başarı';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from app.users;
    raise exception 'beklenmedik başarı';
  exception when insufficient_privilege then
    null;
  end;

  -- yeni oyun
  g := public.tb_admin_game(ta, 'new');
  assert g ->> 'status' = 'waiting' and jsonb_array_length(g -> 'taken') = 0;
  r := public.tb_deck();
  assert jsonb_array_length(r -> 'cards') = 100;

  raise notice 'TÜM TESTLER GEÇTİ (kazanılan toplam ödül: %)', total;
end $$;

rollback;
