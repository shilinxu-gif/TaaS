package com.taas.ops;

import com.taas.infra.util.Ids;
import com.taas.infra.util.Jsons;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final Jsons jsons;

  public AuditService(NamedParameterJdbcTemplate jdbcTemplate, Jsons jsons) {
    this.jdbcTemplate = jdbcTemplate;
    this.jsons = jsons;
  }

  public void write(
      String tenantId,
      String userId,
      String actorType,
      String action,
      String entityType,
      String entityId,
      String ip,
      Map<String, Object> metadata) {
    jdbcTemplate.update(
        """
        insert into audit_logs (
          id, tenant_id, user_id, actor_type, action, entity_type, entity_id, ip, metadata, created_at
        ) values (
          :id, :tenantId, :userId, :actorType, :action, :entityType, :entityId, :ip, cast(:metadata as jsonb), :createdAt
        )
        """,
        new MapSqlParameterSource()
            .addValue("id", Ids.cuidLike("audit"))
            .addValue("tenantId", tenantId)
            .addValue("userId", userId, Types.VARCHAR)
            .addValue("actorType", actorType)
            .addValue("action", action)
            .addValue("entityType", entityType)
            .addValue("entityId", entityId, Types.VARCHAR)
            .addValue("ip", ip, Types.VARCHAR)
            .addValue("metadata", jsons.stringify(metadata == null ? Map.of() : metadata))
            .addValue("createdAt", Timestamp.from(Instant.now())));
  }
}
