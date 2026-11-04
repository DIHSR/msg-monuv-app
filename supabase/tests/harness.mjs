// Postgres local (PGlite) com stubs dos objetos específicos do Supabase,
// para testar as migrations sem depender de um projeto real.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const SUPABASE_STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema vault;
grant usage on schema public, auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text,
  email_change text default '', banned_until timestamptz, deleted_at timestamptz, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
  returns uuid language sql as $$ insert into vault.secrets(secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
  returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
create publication supabase_realtime;
-- privilégios padrão do Supabase para objetos novos em public
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

export async function freshDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  }
  const q = (sql, params) => db.query(sql, params)
  const one = async (sql, params) => (await q(sql, params)).rows[0]

  /** Executa `sql` como role authenticated com auth.uid() = uid. */
  const asUser = async (uid, sql, params) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
    try {
      return await q(sql, params)
    } finally {
      await db.exec('reset role;')
    }
  }

  const newUser = async (email) => (await one(`insert into auth.users(email, encrypted_password) values ($1, 'h') returning id`, [email])).id

  const newAccount = async (userId, waba, phone, status = 'connected') =>
    (await one(`insert into public.wa_accounts(user_id, waba_id, phone_number_id, status) values ($1,$2,$3,$4) returning id`, [userId, waba, phone, status])).id

  return { db, q, one, asUser, newUser, newAccount }
}
