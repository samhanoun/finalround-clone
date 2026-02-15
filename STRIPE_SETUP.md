# Stripe setup (EUR + USD billing)

We bill **only in EUR and USD**.

## Env vars

Copy `.env.example` → `.env` and fill:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRICE_ID_PRO_EUR` (monthly €29)
- `PRICE_ID_PRO_USD` (monthly $29)
- `NEXT_PUBLIC_APP_URL` (e.g. http://localhost:3000)

## Stripe dashboard

1. Create two recurring Prices for Pro:
   - €29/month (EUR)
   - $29/month (USD)
2. Add webhook endpoint:
   - `https://<your-domain>/api/webhooks/stripe`
   - events: `customer.created`, `customer.updated`, `customer.subscription.*`
3. Put the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Database

Apply migration:

```bash
supabase db push
```

## Notes

The webhook currently syncs Stripe customer/subscription rows into Supabase.
Next step is to map active/trialing Stripe subscriptions → app `subscriptions.plan_id='pro'`.
