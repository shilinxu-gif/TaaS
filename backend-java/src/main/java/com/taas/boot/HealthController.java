package com.taas.boot;

import com.taas.infra.db.DbHealthMapper;
import java.time.Instant;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
  private final DbHealthMapper dbHealthMapper;
  private final NamedParameterJdbcTemplate jdbcTemplate;

  public HealthController(
      DbHealthMapper dbHealthMapper, NamedParameterJdbcTemplate jdbcTemplate) {
    this.dbHealthMapper = dbHealthMapper;
    this.jdbcTemplate = jdbcTemplate;
  }

  @GetMapping("/health/live")
  public Map<String, Object> live() {
    return Map.of("ok", true, "live", true, "timestamp", Instant.now().toString());
  }

  @GetMapping("/health")
  public ResponseEntity<Map<String, Object>> health() {
    try {
      dbHealthMapper.ping();
      Integer users =
          jdbcTemplate.queryForObject("select count(*) from users", Map.of(), Integer.class);
      Integer tenantMembers =
          jdbcTemplate.queryForObject(
              "select count(*) from tenant_members", Map.of(), Integer.class);
      return ResponseEntity.ok(
          Map.of(
              "ok", true,
              "database", "up",
              "users", users == null ? 0 : users,
              "tenantMembers", tenantMembers == null ? 0 : tenantMembers));
    } catch (Exception exception) {
      return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
          .body(
              Map.of(
                  "ok", false,
                  "database", "error",
                  "error",
                      exception.getMessage() == null
                          ? exception.getClass().getSimpleName()
                          : exception.getMessage()));
    }
  }
}
