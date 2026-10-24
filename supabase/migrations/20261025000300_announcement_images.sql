-- PeopleCore · Announcements: one picture each (JPEG or PNG, 2 MB at most) in the private `announcement-images`
-- bucket, which signed-in users can't reach. The server stores the picture for an announcement it has just saved
-- (announcement.manage, as for the text) and signs a short-lived link only for an announcement the viewer can see
-- (RLS on announcements decides). The path always sits under the announcement's own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcement-images', 'announcement-images', false, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

alter table public.announcements add column image_path text
  check (image_path is null or image_path ~ ('^' || organization_id || '/' || id || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
