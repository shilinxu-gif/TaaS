package com.taas.auth;

import com.taas.infra.api.ApiException;
import com.taas.infra.config.TaasProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
  private final TaasProperties properties;

  public JwtService(TaasProperties properties) {
    this.properties = properties;
  }

  public String issue(String userId, String tenantId, String role, String platformRole) {
    Instant now = Instant.now();
    return Jwts.builder()
        .issuer(properties.getAuth().getIssuer())
        .subject(userId)
        .claims(Map.of("tenantId", tenantId, "role", role, "platformRole", platformRole == null ? "user" : platformRole))
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plusSeconds(properties.getAuth().getExpireSeconds())))
        .signWith(signingKey())
        .compact();
  }

  public JwtPrincipal verify(String token) {
    try {
      Claims claims =
          Jwts.parser()
              .requireIssuer(properties.getAuth().getIssuer())
              .verifyWith((javax.crypto.SecretKey) signingKey())
              .build()
              .parseSignedClaims(token)
              .getPayload();
      return new JwtPrincipal(
          claims.getSubject(),
          claims.get("tenantId", String.class),
          claims.get("role", String.class),
          claims.get("platformRole", String.class));
    } catch (Exception ex) {
      throw new ApiException(401, "Unauthorized");
    }
  }

  private Key signingKey() {
    String secret = properties.getAuth().getJwtSecret();
    while (secret.length() < 32) {
      secret = secret + secret;
    }
    byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
    return Keys.hmacShaKeyFor(bytes);
  }
}
