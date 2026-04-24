package com.taas.gateway;

import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
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
    return jsonEntity(response);
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
    return jsonEntity(response);
  }

  private static ResponseEntity<Object> jsonEntity(GatewayService.GatewayResponse response) {
    HttpHeaders headers = new HttpHeaders();
    response.headers().forEach(headers::add);
    return new ResponseEntity<>(response.body(), headers, response.status());
  }

  /**
   * 使用 {@link ResponseEntity} 全参构造 + {@link HttpHeaders} 设置 SSE Content-Type，避免
   * {@code BodyBuilder.contentType(TEXT_EVENT_STREAM).body(stream)} 在部分环境下仍走
   * HttpMessageConverter 查找 Lambda 转换器的问题。
   */
  private ResponseEntity<Object> toResponse(GatewayService.GatewayStreamResponse response) {
    if (response.body() != null) {
      HttpHeaders headers = new HttpHeaders();
      response.headers().forEach(headers::add);
      return new ResponseEntity<>(response.body(), headers, response.status());
    }
    StreamingResponseBody stream = response.streamBody();
    HttpHeaders headers = new HttpHeaders();
    response.headers().forEach(headers::add);
    headers.setCacheControl("no-cache");
    headers.add("X-Accel-Buffering", "no");
    headers.setContentType(MediaType.TEXT_EVENT_STREAM);
    HttpStatusCode status = response.status();
    return new ResponseEntity<>(stream, headers, status);
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
