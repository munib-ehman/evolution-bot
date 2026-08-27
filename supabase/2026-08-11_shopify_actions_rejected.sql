-- Let merchants explicitly decline a prepared Shopify change.
alter table public.shopify_actions
  drop constraint if exists shopify_actions_status_check;

alter table public.shopify_actions
  add constraint shopify_actions_status_check check (status in (
    'proposed', 'executing', 'succeeded', 'partial', 'failed',
    'stale', 'undone', 'expired', 'rejected'
  ));
