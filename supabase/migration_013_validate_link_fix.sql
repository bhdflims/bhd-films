-- =====================================================================
-- BHD FILMS — MIGRATION 013: Fix server-side link validation to match
-- the client-side fix (vt.tiktok.com / fb.watch)
-- =====================================================================
-- The earlier fix only updated the JS check that runs while typing
-- (src/utils/validators.js). place_order() re-checks the link on the
-- SERVER with its own copy of this same logic (public.validate_target_link)
-- for security - a customer could bypass the browser entirely. That copy
-- still had the old pattern, so a link that now passes on-screen was
-- still getting rejected the moment the order was actually placed.
-- This brings the two back in sync.
-- Safe to run more than once.
-- =====================================================================

create or replace function public.validate_target_link(p_platform text, p_url text)
returns boolean
language plpgsql immutable as $$
begin
  if p_url is null or length(trim(p_url)) = 0 then
    return false;
  end if;
  case p_platform
    when 'instagram' then return p_url ~* '^https?://(www\.)?instagram\.com/.+';
    when 'facebook' then return p_url ~* '^https?://(www\.)?(facebook\.com|fb\.com|fb\.watch)/.+';
    when 'tiktok' then return p_url ~* '^https?://(www\.|vm\.|vt\.|m\.)?tiktok\.com/.+';
    when 'youtube' then return p_url ~* '^https?://(www\.|m\.)?(youtube\.com|youtu\.be)/.+';
    when 'twitter' then return p_url ~* '^https?://(www\.)?(twitter\.com|x\.com)/.+';
    when 'telegram' then return p_url ~* '^https?://(www\.)?(t\.me|telegram\.me)/.+';
    when 'whatsapp' then return p_url ~* '^https?://(www\.)?(wa\.me|chat\.whatsapp\.com)/.+';
    when 'spotify' then return p_url ~* '^https?://(open\.)?spotify\.com/.+';
    when 'threads' then return p_url ~* '^https?://(www\.)?threads\.net/.+';
    when 'linkedin' then return p_url ~* '^https?://(www\.)?linkedin\.com/.+';
    when 'snapchat' then return p_url ~* '^https?://(www\.)?snapchat\.com/.+';
    when 'pinterest' then return p_url ~* '^https?://(www\.)?pinterest\.[a-z.]+/.+';
    else return p_url ~* '^https?://.+';
  end case;
end;
$$;
