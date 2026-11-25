alter table dmflow.rules
  add column public_reply_variants text[],
  add constraint rules_public_reply_variants_check check (
    public_reply_variants is null or (
      cardinality(public_reply_variants) = 4
      and array_position(public_reply_variants, null::text) is null
    )
  );
