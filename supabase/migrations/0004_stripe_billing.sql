-- Stripe billing scaffolding (EUR/USD price books)

create table if not exists public.stripe_customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id)
);

create table if not exists public.stripe_subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null references public.stripe_customers(stripe_customer_id) on delete cascade,
  stripe_price_id text,
  status text not null,
  currency text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stripe_customers_stripe_customer_id_idx on public.stripe_customers(stripe_customer_id);
create index if not exists stripe_subscriptions_user_id_idx on public.stripe_subscriptions(user_id);
create index if not exists stripe_subscriptions_customer_id_idx on public.stripe_subscriptions(stripe_customer_id);
create index if not exists stripe_subscriptions_status_idx on public.stripe_subscriptions(status);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_stripe_customers on public.stripe_customers;
create trigger set_updated_at_stripe_customers
before update on public.stripe_customers
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_stripe_subscriptions on public.stripe_subscriptions;
create trigger set_updated_at_stripe_subscriptions
before update on public.stripe_subscriptions
for each row execute function public.set_updated_at();

alter table public.stripe_customers enable row level security;
alter table public.stripe_subscriptions enable row level security;

-- Users can read their own billing rows.
create policy "read_own_stripe_customers" on public.stripe_customers
for select to authenticated
using (auth.uid() = user_id);

create policy "read_own_stripe_subscriptions" on public.stripe_subscriptions
for select to authenticated
using (auth.uid() = user_id);
