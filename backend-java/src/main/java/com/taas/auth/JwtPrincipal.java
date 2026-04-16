package com.taas.auth;

public record JwtPrincipal(String userId, String tenantId, String role, String platformRole) {
}
