-- OPTIONAL, requires Supabase pg_cron, pg_net and Vault enabled.
-- This only dispatches GitHub Actions when Anpi Drama has overdue Reel jobs.
-- No video/token bytes are sent in this request.
-- Prerequisites:
--   Vercel secret REELS_CRON_SECRET (random 32+ chars)
--   Vercel secret GITHUB_REELS_WORKFLOW_TOKEN (fine-grained PAT with Actions:write)
--   Supabase Vault secret with name anpi_reels_cron_secret and SAME REELS_CRON_SECRET value
--
-- First store your secret once, in SQL Editor ONLY, not in this repository:
-- select vault.create_secret('<YOUR_PRIVATE_32_PLUS_CHARACTER_SECRET>', 'anpi_reels_cron_secret');
--
-- Then run the statement below. Supabase Cron triggers every two minutes.
select cron.schedule(
  'anpi-reels-dispatch',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := 'https://anpinime-dramavideo.vercel.app/api/reels/cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Reels-Cron-Key', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'anpi_reels_cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 12000
    );
  $$
);
-- To stop scheduled dispatch:
-- select cron.unschedule('anpi-reels-dispatch');
-- Inspect outcome in Dashboard > Integrations > Cron > History,
-- or query cron.job_run_details and net._http_response (recent requests).
