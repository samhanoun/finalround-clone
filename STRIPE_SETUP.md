# Stripe setup (EUR + USD billing)

Pro is a monthly subscription, billed in **EUR or USD** through Stripe Checkout. Users manage it (card, invoices, cancel) in Stripe's billing portal. The code pins API version **`2026-09-30.endive`** (stripe-node 23).

## Env vars

Copy `.env.example` → `.env.local` and fill:

- `STRIPE_SECRET_KEY`: use a **test** key (`sk_test_…`) until launch
- `STRIPE_WEBHOOK_SECRET`
- `PRICE_ID_PRO_EUR` (monthly €29)
- `PRICE_ID_PRO_USD` (monthly $29)
- `NEXT_PUBLIC_APP_URL` (e.g. http://localhost:3000): Checkout and the portal send users back here

`npm run check:live` reports whether Stripe is configured and in test or live mode.

## Stripe dashboard (test mode first)

1. **Product and prices:** a "Pro" product with two recurring monthly prices, €29 (EUR) and $29 (USD). Put their `price_…` ids in the env vars above.
2. **Billing portal:** Settings → Billing → Customer portal. Turn on cancelling, updating payment methods and viewing invoices, then save once (Stripe needs a saved configuration before portal sessions work).
3. **Webhook endpoint:** `https://<your-domain>/api/webhooks/stripe`, created on API version `2026-09-30.endive`, with these events:
   - `checkout.session.completed`
   - `customer.created`, `customer.updated`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

   Put its signing secret in `STRIPE_WEBHOOK_SECRET`.

## Local testing

The Stripe CLI forwards test events to your machine and prints a signing secret for it:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use that `whsec_…` as `STRIPE_WEBHOOK_SECRET` while testing, start the app (`npm run dev`), then in Settings choose **Upgrade to Pro** and pay with the test card `4242 4242 4242 4242` (any future date, any CVC). Your plan should switch to Pro within seconds; **Manage billing** opens the portal, where cancelling moves you back to Free at the end of the period.

## How it fits together

- `POST /api/billing/checkout` creates (once) a Stripe customer tagged with the user id, then a subscription Checkout Session for the chosen currency's price. The price id never comes from the browser.
- `POST /api/billing/portal` opens the portal for the user's own customer.
- The webhook verifies the signature, then re-reads each subscription from Stripe (so out-of-order events can't leave a stale state) and syncs `stripe_customers`, `stripe_subscriptions` and the app's `subscriptions` row (`plan_id = 'pro'`), which drives quotas. Pro stays on while the subscription is `active` or `trialing`, and for 7 days of a `past_due` renewal (enforced through the plan's end date, whatever the retry settings).
- A failed sync returns 500, so Stripe retries the event (with backoff, for up to three days); every handler is safe to repeat.
- Users can read but not change `subscriptions` and `usage_counters` (migration `0026_lock_billing_tables.sql`); only the service role writes them.

## Database

Migrations `0004_stripe_billing.sql`, `0005_subscription_sync.sql` and `0026_lock_billing_tables.sql`:

```bash
supabase db push
```
