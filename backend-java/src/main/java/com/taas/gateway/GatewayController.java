package com.taas.gateway;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GatewayController {
  private final GatewayService gatewayService;

  public GatewayController(GatewayService gatewayService) {
    this.gatewayService = gatewayService;
  }

  @PostMapping({"/v1/chat/completions", "/gateway/v1/chat/completions"})
  public ResponseEntity<Map<String, Object>> completions(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body) {
    GatewayService.GatewayResponse response =
        gatewayService.chatCompletions(authorization, idempotencyKey, clientIp(forwardedFor), body);
    ResponseEntity.BodyBuilder builder = ResponseEntity.status(response.status());
    response.headers().forEach(builder::header);
    return builder.body(response.body());
  }

  @PostMapping({"/v1/messages", "/gateway/v1/messages"})
  public ResponseEntity<Map<String, Object>> anthropicMessages(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "x-api-key", required = false) String xApiKey,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body) {
    GatewayService.GatewayResponse response =
        gatewayService.anthropicMessages(
            authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
    ResponseEntity.BodyBuilder builder = ResponseEntity.status(response.status());
    response.headers().forEach(builder::header);
    return builder.body(response.body());
  }

  private String clientIp(String forwardedFor) {
    if (forwardedFor == null || forwardedFor.isBlank()) {
      return "127.0.0.1";
    }
    return forwardedFor.split(",")[0].trim();
  }
}
