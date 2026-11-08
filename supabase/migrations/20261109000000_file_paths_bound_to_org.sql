-- PeopleCore · Stored file paths must point into the organization's own folder (audit SEC-10).
--
-- Letter headers, footers and signatures, ID-card logos and statutory filing proofs were checked only for their shape
-- (uuid/uuid), so a row could point at another organization's file, which the app would then sign and show. The app
-- always stores them under the organization's id; now the database insists on it, as it already did for the company
-- logo. Enforced for new and changed rows at once; existing rows are checked too where they allow it, and a row that
-- doesn't is reported in the log instead of stopping the deploy.

alter table public.letter_settings
  add constraint letter_settings_header_in_org check (header_path is null or split_part(header_path, '/', 1) = organization_id::text) not valid,
  add constraint letter_settings_footer_in_org check (footer_path is null or split_part(footer_path, '/', 1) = organization_id::text) not valid;
alter table public.letter_signatories
  add constraint letter_signatories_signature_in_org check (signature_path is null or split_part(signature_path, '/', 1) = organization_id::text) not valid;
alter table public.id_card_designs
  add constraint id_card_designs_logo_in_org check (logo_path is null or split_part(logo_path, '/', 1) = organization_id::text) not valid;
alter table public.statutory_filings
  add constraint statutory_filings_proof_in_org check (proof_path is null or split_part(proof_path, '/', 1) = organization_id::text) not valid;

do $$
declare
  c record;
begin
  for c in select * from (values
    ('public.letter_settings', 'letter_settings_header_in_org'), ('public.letter_settings', 'letter_settings_footer_in_org'),
    ('public.letter_signatories', 'letter_signatories_signature_in_org'), ('public.id_card_designs', 'id_card_designs_logo_in_org'),
    ('public.statutory_filings', 'statutory_filings_proof_in_org')) v(tbl, con)
  loop
    begin
      execute format('alter table %s validate constraint %I', c.tbl, c.con);
    exception when check_violation then
      raise notice 'Existing rows break %; new and changed rows are still checked.', c.con;
    end;
  end loop;
end $$;
