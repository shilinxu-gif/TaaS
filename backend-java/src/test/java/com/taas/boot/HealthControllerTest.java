package com.taas.boot;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.taas.infra.db.DbHealthMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

class HealthControllerTest {
  private final DbHealthMapper dbHealthMapper = mock(DbHealthMapper.class);
  private final NamedParameterJdbcTemplate jdbcTemplate = mock(NamedParameterJdbcTemplate.class);
  private final HealthController controller = new HealthController(dbHealthMapper, jdbcTemplate);

  @Test
  void liveShouldAlwaysReturnOk() {
    Map<String, Object> body = controller.live();

    assertTrue((Boolean) body.get("ok"));
    assertEquals(true, body.get("live"));
    assertTrue(body.containsKey("timestamp"));
  }

  @Test
  void healthShouldReportDatabaseCounts() {
    when(jdbcTemplate.queryForObject("select count(*) from users", Map.of(), Integer.class))
        .thenReturn(3);
    when(
            jdbcTemplate.queryForObject(
                "select count(*) from tenant_members", Map.of(), Integer.class))
        .thenReturn(7);

    ResponseEntity<Map<String, Object>> response = controller.health();

    assertEquals(HttpStatus.OK, response.getStatusCode());
    assertEquals("up", response.getBody().get("database"));
    assertEquals(3, response.getBody().get("users"));
    assertEquals(7, response.getBody().get("tenantMembers"));
  }

  @Test
  void healthShouldReturn503WhenDatabaseFails() {
    doThrow(new RuntimeException("db down")).when(dbHealthMapper).ping();

    ResponseEntity<Map<String, Object>> response = controller.health();

    assertEquals(HttpStatus.SERVICE_UNAVAILABLE, response.getStatusCode());
    assertFalse((Boolean) response.getBody().get("ok"));
    assertEquals("error", response.getBody().get("database"));
    assertEquals("db down", response.getBody().get("error"));
  }
}
