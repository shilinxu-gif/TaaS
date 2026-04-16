package com.taas.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.taas.infra.config.TaasProperties;
import com.taas.ops.AuditService;
import java.lang.reflect.Method;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {
  private final NamedParameterJdbcTemplate jdbcTemplate = mock(NamedParameterJdbcTemplate.class);
  private final AuthService authService =
      new AuthService(
          jdbcTemplate,
          mock(PasswordEncoder.class),
          mock(JwtService.class),
          mock(TaasProperties.class),
          mock(AuditService.class));

  @Test
  void resolveLoginEmailShouldPreferLegacyCrmSuffix() throws Exception {
    stubUserCount("demo@crm.local", 1);

    assertEquals("demo@crm.local", invokeResolveLoginEmail("demo"));
  }

  @Test
  void resolveLoginEmailShouldDefaultToCrmSuffixWhenNoUserExistsYet() throws Exception {
    assertEquals("new-user@crm.local", invokeResolveLoginEmail("new-user"));
  }

  private void stubUserCount(String email, int count) {
    when(
            jdbcTemplate.queryForObject(
                eq("select count(*) from users where email = :email"),
                argThat((Map<String, ?> params) -> email.equals(params.get("email"))),
                eq(Integer.class)))
        .thenReturn(count);
  }

  private String invokeResolveLoginEmail(String login) throws Exception {
    Method method = AuthService.class.getDeclaredMethod("resolveLoginEmail", String.class);
    method.setAccessible(true);
    return (String) method.invoke(authService, login);
  }
}
