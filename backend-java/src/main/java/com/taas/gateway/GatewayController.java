package com.taas.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
public class GatewayController {
  private final GatewayService gatewayService;
  private final ObjectMapper objectMapper;

  public GatewayController(GatewayService gatewayService, ObjectMapper objectMapper) {
    this.gatewayService = gatewayService;
    this.objectMapper = objectMapper;
  }

  /**
   * 使用 {@link HttpServletResponse} 直接写出 JSON / SSE，避免部分 Spring 版本在
   * {@code ResponseEntity<StreamingResponseBody>} 或 {@code Object} 返回类型下仍选用
   * {@code HttpMessageConverter}，从而报 “No converter for … Lambda … text/event-stream”。
   */
  @PostMapping({"/v1/chat/completions", "/gateway/v1/chat/completions"})
  public void completions(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body,
      HttpServletResponse response)
      throws IOException {
    if (streamRequested(body)) {
      GatewayService.GatewayStreamResponse streamResponse =
          gatewayService.chatCompletionsStream(
              authorization, idempotencyKey, clientIp(forwardedFor), body);
      if (streamResponse.body() != null) {
        writeJson(response, streamResponse.status(), streamResponse.headers(), streamResponse.body());
        return;
      }
      writeSse(response, streamResponse);
      return;
    }
    GatewayService.GatewayResponse gatewayResponse =
        gatewayService.chatCompletions(authorization, idempotencyKey, clientIp(forwardedFor), body);
    writeJson(response, gatewayResponse.status(), gatewayResponse.headers(), gatewayResponse.body());
  }

  @PostMapping({"/v1/messages", "/gateway/v1/messages"})
  public void anthropicMessages(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "x-api-key", required = false) String xApiKey,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
      @RequestBody Map<String, Object> body,
      HttpServletResponse response)
      throws IOException {
    if (streamRequested(body)) {
      GatewayService.GatewayStreamResponse streamResponse =
          gatewayService.anthropicMessagesStream(
              authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
      if (streamResponse.body() != null) {
        writeJson(response, streamResponse.status(), streamResponse.headers(), streamResponse.body());
        return;
      }
      writeSse(response, streamResponse);
      return;
    }
    GatewayService.GatewayResponse gatewayResponse =
        gatewayService.anthropicMessages(
            authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
    writeJson(response, gatewayResponse.status(), gatewayResponse.headers(), gatewayResponse.body());
  }

  private void writeJson(
      HttpServletResponse response,
      HttpStatus status,
      Map<String, String> headers,
      Map<String, Object> body)
      throws IOException {
    response.setStatus(status.value());
    headers.forEach(response::addHeader);
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    objectMapper.writeValue(response.getOutputStream(), body);
  }

  private void writeSse(HttpServletResponse response, GatewayService.GatewayStreamResponse streamResponse)
      throws IOException {
    StreamingResponseBody stream = streamResponse.streamBody();
    response.setStatus(streamResponse.status().value());
    streamResponse.headers().forEach(response::addHeader);
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-cache");
    response.addHeader("X-Accel-Buffering", "no");
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    response.setContentType(MediaType.TEXT_EVENT_STREAM_VALUE);
    stream.writeTo(response.getOutputStream());
    response.getOutputStream().flush();
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
