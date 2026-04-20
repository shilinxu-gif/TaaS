package com.taas.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taas.infra.i18n.ApiMessageResolver;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
  private static final List<String> PUBLIC_PREFIXES =
      List.of(
          "/auth/login",
          "/auth/register",
          "/health",
          "/actuator",
          "/v1/chat/completions",
          "/gateway/v1/chat/completions");

  private final JwtService jwtService;
  private final NamedParameterJdbcTemplate jdbcTemplate;
  private final ApiMessageResolver messages;
  private final ObjectMapper objectMapper;

  public JwtAuthenticationFilter(
      JwtService jwtService,
      NamedParameterJdbcTemplate jdbcTemplate,
      ApiMessageResolver messages,
      ObjectMapper objectMapper) {
    this.jwtService = jwtService;
    this.jdbcTemplate = jdbcTemplate;
    this.messages = messages;
    this.objectMapper = objectMapper;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String uri = request.getRequestURI();
    return PUBLIC_PREFIXES.stream().anyMatch(uri::startsWith);
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    try {
      String authorization = request.getHeader("Authorization");
      if (authorization == null || !authorization.startsWith("Bearer ")) {
        writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "error.unauthorized");
        return;
      }
      String token = authorization.substring(7).trim();
      if (token.startsWith("sk-")) {
        writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "error.consoleJwtRequired");
        return;
      }
      JwtPrincipal verified = jwtService.verify(token);
      String platformRole =
          jdbcTemplate
              .query(
                  "select coalesce(platform_role, 'user') from users where id = :userId limit 1",
                  Map.of("userId", verified.userId()),
                  (rs, rowNum) -> rs.getString(1))
              .stream()
              .findFirst()
              .orElse("user");
      String role =
          jdbcTemplate
              .query(
                  """
                  select role
                  from tenant_members
                  where user_id = :userId and tenant_id = :tenantId
                  order by id asc
                  limit 1
                  """,
                  Map.of("userId", verified.userId(), "tenantId", verified.tenantId()),
                  (rs, rowNum) -> rs.getString("role"))
              .stream()
              .findFirst()
              .orElse(null);
      if (role == null || role.isBlank()) {
        writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "error.unauthorized");
        return;
      }
      JwtPrincipal principal = new JwtPrincipal(verified.userId(), verified.tenantId(), role, platformRole);
      RequestContext.set(principal);
      SecurityContextHolder.getContext()
          .setAuthentication(
              new UsernamePasswordAuthenticationToken(
                  principal.userId(),
                  null,
                  List.of(new SimpleGrantedAuthority("ROLE_" + principal.role().toUpperCase()))));
      filterChain.doFilter(request, response);
    } finally {
      RequestContext.clear();
      SecurityContextHolder.clearContext();
    }
  }

  private void writeError(HttpServletResponse response, int status, String key)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json;charset=UTF-8");
    objectMapper.writeValue(response.getWriter(), Map.of("error", messages.get(key)));
  }
}
