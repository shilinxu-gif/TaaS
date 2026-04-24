package com.taas.gateway;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 按租户加载控制台「缓存策略」；热路径经 Caffeine 短 TTL，避免每次请求打库。
 *
 * <p>MVP：{@code semantic}/{@code hybrid} 与 {@code exact} 相同，仅控制幂等响应缓存开关与 Redis TTL，不做向量语义缓存。
 */
@Service
public class TenantIdempotencyCachePolicyService {

  private static final int CACHE_SPEC_TTL_SECONDS = 45;
  private static final int DEFAULT_TTL_SECONDS = 86400;
  private static final int MIN_TTL_SECONDS = 60;
  private static final int MAX_TTL_SECONDS = 604800;

  public record IdempotencyPolicy(boolean enabled, Duration redisTtl) {
    static IdempotencyPolicy defaults() {
      return new IdempotencyPolicy(true, Duration.ofSeconds(DEFAULT_TTL_SECONDS));
    }
  }

  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final Cache<String, IdempotencyPolicy> policyByTenant =
      Caffeine.newBuilder().expireAfterWrite(Duration.ofSeconds(CACHE_SPEC_TTL_SECONDS)).build();

  public TenantIdempotencyCachePolicyService(NamedParameterJdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public IdempotencyPolicy forTenant(String tenantId) {
    if (tenantId == null || tenantId.isBlank()) {
      return IdempotencyPolicy.defaults();
    }
    return policyByTenant.get(tenantId, this::load);
  }

  private IdempotencyPolicy load(String tenantKey) {
    List<IdempotencyPolicy> rows =
        jdbcTemplate.query(
            """
            select enabled, ttl_seconds
            from tenant_cache_settings
            where tenant_id = :tenantId
            limit 1
            """,
            Map.of("tenantId", tenantKey),
            (rs, rowNum) ->
                new IdempotencyPolicy(
                    rs.getBoolean("enabled"), Duration.ofSeconds(clampTtlSeconds(rs.getInt("ttl_seconds")))));
    return rows.stream().findFirst().orElse(IdempotencyPolicy.defaults());
  }

  private static int clampTtlSeconds(int seconds) {
    if (seconds < MIN_TTL_SECONDS) {
      return MIN_TTL_SECONDS;
    }
    if (seconds > MAX_TTL_SECONDS) {
      return MAX_TTL_SECONDS;
    }
    return seconds;
  }
}
