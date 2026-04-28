ALTER TABLE providers
ADD COLUMN IF NOT EXISTS model_vendor VARCHAR(80);

UPDATE providers
SET model_vendor = CASE
  WHEN slug = 'claude' OR provider_type = 'anthropic' THEN 'Anthropic'
  WHEN slug = 'gemini' OR provider_type = 'google' THEN 'Google'
  WHEN slug LIKE 'deepseek%' THEN 'DeepSeek'
  WHEN slug LIKE 'qwen%' THEN 'Qwen'
  WHEN provider_type = 'openai' THEN 'OpenAI'
  ELSE model_vendor
END
WHERE model_vendor IS NULL;
