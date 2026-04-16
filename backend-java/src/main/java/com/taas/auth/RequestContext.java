package com.taas.auth;

public final class RequestContext {
  private static final ThreadLocal<JwtPrincipal> HOLDER = new ThreadLocal<>();

  private RequestContext() {
  }

  public static void set(JwtPrincipal principal) {
    HOLDER.set(principal);
  }

  public static JwtPrincipal getRequired() {
    JwtPrincipal principal = HOLDER.get();
    if (principal == null) {
      throw new com.taas.infra.api.ApiException(401, "Unauthorized");
    }
    return principal;
  }

  public static void clear() {
    HOLDER.remove();
  }
}
