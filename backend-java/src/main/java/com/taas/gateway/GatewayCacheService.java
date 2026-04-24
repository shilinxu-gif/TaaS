package com.taas.gateway;

import com.taas.infra.util.Jsons;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class GatewayCacheService {
  private final StringRedisTemplate redisTemplate;
  private final Jsons jsons;
  private final Map<String, String> localStore = new ConcurrentHashMap<>();
  private final Map<String, Long> localCounter = new ConcurrentHashMap<>();

  public GatewayCacheService(StringRedisTemplate redisTemplate, Jsons jsons) {
    this.redisTemplate = redisTemplate;
    this.jsons = jsons;
  }

  @SuppressWarnings("unchecked")
  public Map<String, Object> getIdempotentResponse(String key) {
    try {
      String raw = redisTemplate.opsForValue().get("idem:" + key);
      return raw == null ? null : jsons.readObject(raw);
    } catch (Exception ignored) {
      String raw = localStore.get(key);
      return raw == null ? null : jsons.readObject(raw);
    }
  }

  public void setIdempotentResponse(String key, Map<String, Object> payload) {
    setIdempotentResponse(key, payload, Duration.ofHours(24));
  }

  public void setIdempotentResponse(String key, Map<String, Object> payload, Duration ttl) {
    String raw = jsons.stringify(payload);
    Duration effective = ttl == null || ttl.isNegative() || ttl.isZero() ? Duration.ofHours(24) : ttl;
    try {
      redisTemplate.opsForValue().set("idem:" + key, raw, effective);
    } catch (Exception ignored) {
      localStore.put(key, raw);
    }
  }

  public boolean checkRateLimit(String key, Integer qpsLimit) {
    if (qpsLimit == null || qpsLimit <= 0) {
      return true;
    }
    try {
      Long value = redisTemplate.opsForValue().increment("rate:" + key);
      if (value != null && value == 1) {
        redisTemplate.expire("rate:" + key, Duration.ofSeconds(1));
      }
      return value == null || value <= qpsLimit;
    } catch (Exception ignored) {
      long second = System.currentTimeMillis() / 1000;
      String localKey = key + ":" + second;
      long value = localCounter.merge(localKey, 1L, Long::sum);
      return value <= qpsLimit;
    }
  }
}
