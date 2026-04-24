package com.taas.gateway;

import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
public class GatewayController {
  private final GatewayService gatewayService;

  public GatewayController(GatewayService gatewayService) {
    this.gatewayService = gatewayService;
  }

  /**
   * 返回类型使用 {@code ResponseEntity<Object>} 而非 {@code ResponseEntity<?>}，避免 Spring 在流式分支将
   * {@link StreamingResponseBody} 误判为需 HttpMessageConverter 序列化的对象，从而抛出 “No converter for …
   * Lambda … text/event-stream”（参见 Spring Framework #25996）。
   */
  @PostMapping({"/v1/chat/completions", "/gateway/v1/chat/completions"})
  public ResponseEntity<Object> completions(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body) {
    if (streamRequested(body)) {
      return toResponse(
          gatewayService.chatCompletionsStream(
              authorization, idempotencyKey, clientIp(forwardedFor), body));
    }
    GatewayService.GatewayResponse response =
        gatewayService.chatCompletions(authorization, idempotencyKey, clientIp(forwardedFor), body);
    ResponseEntity.BodyBuilder builder = ResponseEntity.status(response.status());
    response.headers().forEach(builder::header);
    return builder.body(response.body());
  }

  @PostMapping({"/v1/messages", "/gateway/v1/messages"})
  public ResponseEntity<Object> anthropicMessages(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "x-api-key", required = false) String xApiKey,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body) {
    if (streamRequested(body)) {
      return toResponse(
          gatewayService.anthropicMessagesStream(
              authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body));
    }
    GatewayService.GatewayResponse response =
        gatewayService.anthropicMessages(
            authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
    ResponseEntity.BodyBuilder builder = ResponseEntity.status(response.status());
    response.headers().forEach(builder::header);
    return builder.body(response.body());
  }

  private ResponseEntity<Object> toResponse(GatewayService.GatewayStreamResponse response) {
    ResponseEntity.BodyBuilder builder = ResponseEntity.status(response.status());
    response.headers().forEach(builder::header);
    if (response.body() != null) {
      return builder.body(response.body());
    }
    builder.header(HttpHeaders.CACHE_CONTROL, "no-cache");
    builder.header("X-Accel-Buffering", "no");
    builder.contentType(MediaType.TEXT_EVENT_STREAM);
    StreamingResponseBody stream = response.streamBody();
    return builder.body(stream);
  }

  private boolean streamRequested(Map<String, Object> body) {
    Object raw = body.get("stream");
    if (raw instanceof Boolean bool) {
      return bool;
    }
    return raw != null && "true".equalsIgnoreCase(String.valueOf(raw));
  }

  private String clientIp(String forwardedFor) {
    if (forwardedFor == null || forwardedFor.isBlank()) {
      return "127.0.0.1";
    }
    return forwardedFor.split(",")[0].trim();
  }
}
