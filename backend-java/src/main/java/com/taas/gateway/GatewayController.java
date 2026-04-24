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
   * 返回 {@link Object}，流式成功时返回 {@code ResponseEntity<StreamingResponseBody>}，流式错误与非流式返回
   * {@code ResponseEntity<Map<String, Object>>}。若仅声明 {@code ResponseEntity<Object>}，部分 Spring 版本仍按
   * {@code Object} 选择 HttpMessageConverter，导致 “No converter for … Lambda … text/event-stream”。
   */
  @PostMapping({"/v1/chat/completions", "/gateway/v1/chat/completions"})
  public Object completions(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body) {
    if (streamRequested(body)) {
      GatewayService.GatewayStreamResponse streamResponse =
          gatewayService.chatCompletionsStream(
              authorization, idempotencyKey, clientIp(forwardedFor), body);
      if (streamResponse.body() != null) {
        return streamJsonEntity(streamResponse);
      }
      return streamSseEntity(streamResponse);
    }
    GatewayService.GatewayResponse response =
        gatewayService.chatCompletions(authorization, idempotencyKey, clientIp(forwardedFor), body);
    return jsonEntity(response);
  }

  @PostMapping({"/v1/messages", "/gateway/v1/messages"})
  public Object anthropicMessages(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "x-api-key", required = false) String xApiKey,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body) {
    if (streamRequested(body)) {
      GatewayService.GatewayStreamResponse streamResponse =
          gatewayService.anthropicMessagesStream(
              authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
      if (streamResponse.body() != null) {
        return streamJsonEntity(streamResponse);
      }
      return streamSseEntity(streamResponse);
    }
    GatewayService.GatewayResponse response =
        gatewayService.anthropicMessages(
            authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
    return jsonEntity(response);
  }

  private static ResponseEntity<Map<String, Object>> jsonEntity(GatewayService.GatewayResponse response) {
    HttpHeaders headers = new HttpHeaders();
    response.headers().forEach(headers::add);
    return new ResponseEntity<>(response.body(), headers, response.status());
  }

  private static ResponseEntity<Map<String, Object>> streamJsonEntity(
      GatewayService.GatewayStreamResponse response) {
    HttpHeaders headers = new HttpHeaders();
    response.headers().forEach(headers::add);
    return new ResponseEntity<>(response.body(), headers, response.status());
  }

  private static ResponseEntity<StreamingResponseBody> streamSseEntity(
      GatewayService.GatewayStreamResponse response) {
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
