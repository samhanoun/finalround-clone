-- Add auto_optimize column to llm_settings for smart model routing

alter table public.llm_settings 
add column if not exists auto_optimize boolean not null default true;

comment on column public.llm_settings.auto_optimize is 'Enable automatic model selection based on task type and optimization preferences';
