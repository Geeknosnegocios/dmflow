alter table dmflow.scheduled_carousels
  add column media_types text[],
  drop constraint scheduled_carousels_eight_slide_check,
  add constraint scheduled_carousels_slide_check check (
    cardinality(image_urls) between 2 and 10
    and array_position(image_urls, null::text) is null
    and cardinality(slide_hashes) = cardinality(image_urls)
    and array_position(slide_hashes, null::text) is null
    and cardinality(slide_container_ids) is not distinct from cardinality(image_urls)
    and cardinality(slide_statuses) is not distinct from cardinality(image_urls)
    and (
      media_types is null or (
        cardinality(media_types) = cardinality(image_urls)
        and array_position(media_types, null::text) is null
        and media_types <@ array['IMAGE', 'VIDEO']::text[]
      )
    )
  );

create function dmflow.initialize_carousel_slide_checkpoints()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.slide_container_ids is null or new.slide_container_ids = array_fill(null::text, array[8]) then
    new.slide_container_ids := array_fill(null::text, array[cardinality(new.image_urls)]);
  end if;
  if new.slide_statuses is null or new.slide_statuses = array_fill('PENDING'::text, array[8]) then
    new.slide_statuses := array_fill('PENDING'::text, array[cardinality(new.image_urls)]);
  end if;
  return new;
end;
$$;

create trigger initialize_carousel_slide_checkpoints
before insert on dmflow.scheduled_carousels
for each row execute function dmflow.initialize_carousel_slide_checkpoints();
