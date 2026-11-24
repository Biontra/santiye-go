-- 33: Yeni bildirim eklenince siteye (web push gönderimi için) haber veren veritabanı tetikleyicisi.
-- Supabase Dashboard > Database > Webhooks yerine doğrudan pg_net kullanır (aynı iş, kodda izlenebilir).
-- Gizli anahtar bu dosyada YOKTUR: Vault'ta 'push_webhook_secret' adıyla tutulur ve ilk çalıştırmada rastgele üretilir.
-- Aynı değeri hosting ortam değişkenine PUSH_WEBHOOK_SECRET olarak girin. Değeri görmek için SQL Editor'de:
--   select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
-- Alan adı farklıysa aşağıdaki url satırını değiştirin. İdempotent: tekrar çalıştırılabilir.

create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_webhook_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'push_webhook_secret',
      'Web push webhook Bearer anahtari (hosting PUSH_WEBHOOK_SECRET ile ayni olmali)'
    );
  end if;
end $$;

create or replace function public.trg_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault, pg_temp
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'push_webhook_secret'
  limit 1;

  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://santiyego.com/api/notifications/push-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'schema', 'public',
      'record', jsonb_build_object('id', new.id)
    ),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Push gönderilemese bile bildirimin kendisi kaydedilmeli
  raise warning '[push_webhook] %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.trg_push_webhook() from public, anon, authenticated;

drop trigger if exists push_webhook on public.notifications;
create trigger push_webhook
  after insert on public.notifications
  for each row execute function public.trg_push_webhook();
