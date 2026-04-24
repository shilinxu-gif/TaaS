-- 缓存命中行：记录「若未命中缓存、按缓存响应体 usage 估算本会消耗的 token」，与 total_tokens=0 的账单语义分离。
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "saved_tokens_estimate" INTEGER;
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "saved_prompt_tokens" INTEGER;
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "saved_completion_tokens" INTEGER;
