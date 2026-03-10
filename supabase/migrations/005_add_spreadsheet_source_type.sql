-- Add 'spreadsheet' to the data_sources type check constraint
alter table public.data_sources
  drop constraint data_sources_type_check;

alter table public.data_sources
  add constraint data_sources_type_check check (type in (
    'text', 'pdf', 'json_schema', 'website', 'questionnaire',
    'job_description_initial', 'job_description_detailed',
    'call_transcript', 'domain_knowledge', 'spreadsheet'
  ));
