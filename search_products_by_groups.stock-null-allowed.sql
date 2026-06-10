-- Salla AI Chatbot v14
-- Run this file once in Supabase SQL Editor before deploying the Edge Function.
-- This function performs database-level AND-of-OR-groups search:
-- Example required_groups = [["سامسونج","samsung"],["a07"]]
-- means: (سامسونج OR samsung) AND (a07).

create extension if not exists pg_trgm;

create or replace function public.normalize_arabic_search(input_text text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  regexp_replace(lower(coalesce(input_text, '')), '[ًٌٍَُِّْـٰ]', '', 'g'),
                  'أ', 'ا'
                ),
                'إ', 'ا'
              ),
              'آ', 'ا'
            ),
            'ى', 'ي'
          ),
          'ة', 'ه'
        ),
        'ؤ', 'و'
      ),
      '[^[:alnum:]ء-ي]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.search_products_by_groups(
  required_groups jsonb default '[]'::jsonb,
  family_terms text[] default '{}',
  exclude_terms text[] default '{}',
  result_limit integer default 100
)
returns table (
  id text,
  name text,
  name_ar text,
  description text,
  description_ar text,
  category text,
  category_ar text,
  category_id text,
  category_name text,
  category_name_ar text,
  price numeric,
  local_price_egp numeric,
  original_price numeric,
  source text,
  merchant_id text,
  merchant_name text,
  in_stock boolean,
  stock_quantity numeric,
  shipping_type text,
  tags text[],
  search_rank double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized_inputs as (
    select
      coalesce(required_groups, '[]'::jsonb) as required_groups,
      coalesce((select array_remove(array_agg(distinct public.normalize_arabic_search(x)), '') from unnest(coalesce(family_terms, '{}'::text[])) x), '{}'::text[]) as family_terms,
      coalesce((select array_remove(array_agg(distinct public.normalize_arabic_search(x)), '') from unnest(coalesce(exclude_terms, '{}'::text[])) x), '{}'::text[]) as exclude_terms
  ),
  required_group_terms as (
    select
      group_item.ordinality::int as group_index,
      public.normalize_arabic_search(term_item.value::text) as term
    from normalized_inputs ni
    cross join lateral jsonb_array_elements(ni.required_groups) with ordinality as group_item(value, ordinality)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(group_item.value) = 'array' then group_item.value
        else jsonb_build_array(group_item.value)
      end
    ) as term_item(value)
    where public.normalize_arabic_search(term_item.value::text) <> ''
  ),
  candidates as (
    select
      p.id::text as id,
      p.name::text as name,
      p.name_ar::text as name_ar,
      p.description::text as description,
      p.description_ar::text as description_ar,
      p.category::text as category,
      null::text as category_ar,
      p.category_id::text as category_id,
      c.name::text as category_name,
      c.name_ar::text as category_name_ar,
      p.price::numeric as price,
      p.local_price_egp::numeric as local_price_egp,
      p.original_price::numeric as original_price,
      'admin'::text as source,
      null::text as merchant_id,
      null::text as merchant_name,
      p.in_stock::boolean as in_stock,
      p.stock_quantity::numeric as stock_quantity,
      p.shipping_type::text as shipping_type,
      p.tags::text[] as tags,
      p.created_at as created_at,
      public.normalize_arabic_search(concat_ws(' ', p.name, p.name_ar, p.category, c.name, c.name_ar, coalesce(array_to_string(p.tags, ' '), ''), p.description, p.description_ar)) as searchable_text,
      public.normalize_arabic_search(concat_ws(' ', p.name, p.name_ar, p.category, c.name, c.name_ar, coalesce(array_to_string(p.tags, ' '), ''))) as strong_text
    from public.products p
    left join public.categories c on c.id::text = p.category_id::text
    where p.in_stock = true and (p.stock_quantity is null or p.stock_quantity > 0)

    union all

    select
      mp.id::text as id,
      mp.name::text as name,
      mp.name_ar::text as name_ar,
      mp.description::text as description,
      mp.description_ar::text as description_ar,
      mp.category::text as category,
      null::text as category_ar,
      mp.category_id::text as category_id,
      c.name::text as category_name,
      c.name_ar::text as category_name_ar,
      null::numeric as price,
      mp.local_price_egp::numeric as local_price_egp,
      mp.original_price::numeric as original_price,
      'merchant'::text as source,
      mp.merchant_id::text as merchant_id,
      null::text as merchant_name,
      mp.in_stock::boolean as in_stock,
      mp.stock_quantity::numeric as stock_quantity,
      mp.shipping_type::text as shipping_type,
      mp.tags::text[] as tags,
      mp.created_at as created_at,
      public.normalize_arabic_search(concat_ws(' ', mp.name, mp.name_ar, mp.category, c.name, c.name_ar, coalesce(array_to_string(mp.tags, ' '), ''), mp.description, mp.description_ar)) as searchable_text,
      public.normalize_arabic_search(concat_ws(' ', mp.name, mp.name_ar, mp.category, c.name, c.name_ar, coalesce(array_to_string(mp.tags, ' '), ''))) as strong_text
    from public.merchant_products mp
    left join public.categories c on c.id::text = mp.category_id::text
    where mp.in_stock = true and (mp.stock_quantity is null or mp.stock_quantity > 0)
  ),
  filtered as (
    select
      c.*,
      (
        -- A product gets points for matching required groups in strong fields first, then searchable text.
        coalesce((
          select sum(
            case
              when c.strong_text like '%' || grouped.term || '%' then 2.0
              when c.searchable_text like '%' || grouped.term || '%' then 1.0
              else 0.0
            end
          )
          from (
            select distinct on (group_index)
              group_index,
              term
            from required_group_terms rgt
            where c.searchable_text like '%' || rgt.term || '%'
            order by group_index,
              case when c.strong_text like '%' || rgt.term || '%' then 0 else 1 end,
              length(rgt.term) desc
          ) grouped
        ), 0.0)
        + case
            when cardinality((select family_terms from normalized_inputs)) > 0
             and exists (
               select 1 from unnest((select family_terms from normalized_inputs)) family_term
               where family_term <> '' and c.strong_text like '%' || family_term || '%'
             ) then 2.5
            else 0.0
          end
      ) as calculated_rank
    from candidates c
    cross join normalized_inputs i
    where
      -- Database-level AND-of-OR-groups:
      -- every required group must have at least one of its variants in the product searchable text.
      not exists (
        select 1
        from (
          select distinct group_index from required_group_terms
        ) groups
        where not exists (
          select 1
          from required_group_terms terms
          where terms.group_index = groups.group_index
            and c.searchable_text like '%' || terms.term || '%'
        )
      )
      -- Family gate: for generic family searches such as "موبايلات", products must contain a family signal in strong fields.
      and (
        cardinality(i.family_terms) = 0
        or exists (
          select 1
          from unnest(i.family_terms) family_term
          where family_term <> '' and c.strong_text like '%' || family_term || '%'
        )
      )
      -- Exclusions run on strong fields only, not descriptions.
      and not exists (
        select 1
        from unnest(i.exclude_terms) exclude_term
        where exclude_term <> '' and c.strong_text like '%' || exclude_term || '%'
      )
  )
  select
    filtered.id,
    filtered.name,
    filtered.name_ar,
    filtered.description,
    filtered.description_ar,
    filtered.category,
    filtered.category_ar,
    filtered.category_id,
    filtered.category_name,
    filtered.category_name_ar,
    filtered.price,
    filtered.local_price_egp,
    filtered.original_price,
    filtered.source,
    filtered.merchant_id,
    filtered.merchant_name,
    filtered.in_stock,
    filtered.stock_quantity,
    filtered.shipping_type,
    filtered.tags,
    filtered.calculated_rank as search_rank
  from filtered
  order by filtered.calculated_rank desc, filtered.created_at desc nulls last
  limit least(greatest(coalesce(result_limit, 100), 1), 300);
$$;

create index if not exists idx_products_name_trgm on public.products using gin ((public.normalize_arabic_search(coalesce(name, '') || ' ' || coalesce(name_ar, ''))) gin_trgm_ops);
create index if not exists idx_merchant_products_name_trgm on public.merchant_products using gin ((public.normalize_arabic_search(coalesce(name, '') || ' ' || coalesce(name_ar, ''))) gin_trgm_ops);
