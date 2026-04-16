package com.taas.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping
public class AuthController {
  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/auth/register")
  public Map<String, Object> register(
      @Validated @RequestBody RegisterRequest request,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    return authService.register(request.email(), request.password(), request.name(), clientIp(forwardedFor));
  }

  @PostMapping("/auth/login")
  public Map<String, Object> login(
      @Validated @RequestBody LoginRequest request,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor) {
    String login = request.login() != null && !request.login().isBlank() ? request.login() : request.email();
    if (login == null || login.isBlank()) {
      throw new com.taas.infra.api.ApiException(400, "login or email required");
    }
    return authService.login(login, request.password(), clientIp(forwardedFor));
  }

  @GetMapping("/me")
  public Map<String, Object> me() {
    return authService.me(RequestContext.getRequired());
  }

  private String clientIp(String forwardedFor) {
    if (forwardedFor == null || forwardedFor.isBlank()) {
      return "127.0.0.1";
    }
    return forwardedFor.split(",")[0].trim();
  }

  public record RegisterRequest(
      @NotBlank @Email String email,
      @NotBlank @Size(min = 6, max = 128) String password,
      @NotBlank @Size(min = 1, max = 80) String name) {
  }

  public record LoginRequest(
      String login,
      String email,
      @NotBlank @Size(min = 1, max = 128) String password) {
  }
}
