-- Resume builder enhancements: parsing, ATS scoring, keyword optimization, bullet rewriting, multi-version

-- Add parsed content and metadata to resume_documents
alter table public.resume_documents 
add column if not exists parsed_text text,
add column if not exists parsed_data jsonb default '{}'::jsonb,
add column if not exists ats_score numeric,
add column if not exists keywords jsonb default '[]'::jsonb,
add column if not exists version integer not null default 1,
add column if not exists parent_version_id uuid references public.resume_documents(id) on delete set null;

-- Add job_description for ATS scoring
alter table public.resume_generations
add column if not exists job_description text,
add column if not exists ats_score numeric,
add column if not exists keyword_matches jsonb default '[]'::jsonb,
add column if not exists suggested_keywords jsonb default '[]'::jsonb,
add column if not exists bullet_suggestions jsonb default '[]'::jsonb;

-- Add status tracking for parsing
alter table public.resume_documents
add column if not exists parse_status text default 'pending',
add column if not exists parse_error text;

-- Create index for version management
create index if not exists resume_documents_user_version_idx on public.resume_documents(user_id, version desc);

-- Create index for generations with job description
create index if not exists resume_generations_job_desc_idx on public.resume_generations using gin(job_description);

-- Update RLS policies if needed (they should still work with new columns)
