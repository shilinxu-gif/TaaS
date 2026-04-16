package com.taas.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import com.taas.infra.api.ApiException;
import org.junit.jupiter.api.Test;

class AuthControllerTest {
  private final AuthController controller = new AuthController(mock(AuthService.class));

  @Test
  void loginShouldRequireLoginOrEmail() {
    ApiException exception =
        assertThrows(
            ApiException.class,
            () ->
                controller.login(
                    new AuthController.LoginRequest("   ", null, "x"), "127.0.0.1"));

    assertEquals(400, exception.getStatusCode());
    assertEquals("login or email required", exception.getMessage());
  }
}
