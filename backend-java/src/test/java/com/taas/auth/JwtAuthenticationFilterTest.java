package com.taas.auth;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taas.infra.i18n.ApiMessageResolver;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

class JwtAuthenticationFilterTest {
  private final JwtAuthenticationFilter filter =
      new JwtAuthenticationFilter(
          mock(JwtService.class),
          mock(NamedParameterJdbcTemplate.class),
          new ApiMessageResolver(new StaticMessageSource()),
          new ObjectMapper());

  @Test
  void shouldSkipGatewayCompatibilityPath() {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/gateway/v1/chat/completions");

    assertTrue(filter.shouldNotFilter(request));
  }

  @Test
  void shouldRequireJwtForProtectedConsolePath() {
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/me");

    assertFalse(filter.shouldNotFilter(request));
  }
}
