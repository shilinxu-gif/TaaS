package com.taas.gateway;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taas.infra.config.TaasProperties;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
  private static final Logger log = LoggerFactory.getLogger(GatewayController.class);

  private final GatewayService gatewayService;
  private final ObjectMapper objectMapper;
  private final TaasProperties taasProperties;

  public GatewayController(
      GatewayService gatewayService, ObjectMapper objectMapper, TaasProperties taasProperties) {
    this.gatewayService = gatewayService;
    this.objectMapper = objectMapper;
    this.taasProperties = taasProperties;
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
    maybeLogRequest("chat_completions", body);
    if (streamRequested(body)) {
      GatewayService.GatewayStreamResponse streamResponse =
          gatewayService.chatCompletionsStream(
              authorization, idempotencyKey, clientIp(forwardedFor), body);
      if (streamResponse.body() != null) {
        maybeLogJsonResponse("chat_completions_stream_error", streamResponse.body());
        writeJson(response, streamResponse.status(), streamResponse.headers(), streamResponse.body());
        return;
      }
      writeSse(response, streamResponse, "chat_completions");
      return;
    }
    GatewayService.GatewayResponse gatewayResponse =
        gatewayService.chatCompletions(authorization, idempotencyKey, clientIp(forwardedFor), body);
    maybeLogJsonResponse("chat_completions", gatewayResponse.body());
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
    maybeLogRequest("anthropic_messages", body);
    if (streamRequested(body)) {
      GatewayService.GatewayStreamResponse streamResponse =
          gatewayService.anthropicMessagesStream(
              authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
      if (streamResponse.body() != null) {
        maybeLogJsonResponse("anthropic_messages_stream_error", streamResponse.body());
        writeJson(response, streamResponse.status(), streamResponse.headers(), streamResponse.body());
        return;
      }
      writeSse(response, streamResponse, "anthropic_messages");
      return;
    }
    GatewayService.GatewayResponse gatewayResponse =
        gatewayService.anthropicMessages(
            authorization, xApiKey, idempotencyKey, clientIp(forwardedFor), body);
    maybeLogJsonResponse("anthropic_messages", gatewayResponse.body());
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

  private void writeSse(
      HttpServletResponse response, GatewayService.GatewayStreamResponse streamResponse, String route)
      throws IOException {
    StreamingResponseBody stream = streamResponse.streamBody();
    response.setStatus(streamResponse.status().value());
    streamResponse.headers().forEach(response::addHeader);
    response.setHeader(HttpHeaders.CACHE_CONTROL, "no-cache");
    response.addHeader("X-Accel-Buffering", "no");
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    response.setContentType(MediaType.TEXT_EVENT_STREAM_VALUE);
    OutputStream raw = response.getOutputStream();
    if (taasProperties.getGateway().isDebugLogHttpBodies()) {
      int cap = Math.max(256, taasProperties.getGateway().getDebugLogSseHeadMaxChars());
      HeadCopyOutputStream tee = new HeadCopyOutputStream(raw, cap);
      stream.writeTo(tee);
      tee.flush();
      maybeLogSseResponseHead(route, tee.capturedHeadUtf8());
    } else {
      stream.writeTo(raw);
    }
    raw.flush();
  }

  private void maybeLogJsonResponse(String route, Map<String, Object> body) {
    if (!taasProperties.getGateway().isDebugLogHttpBodies()) {
      return;
    }
    log.warn("gateway.debug_http response route={} body={}", route, truncateJsonForLog(body));
  }

  private void maybeLogSseResponseHead(String route, String head) {
    if (!taasProperties.getGateway().isDebugLogHttpBodies()) {
      return;
    }
    log.warn(
        "gateway.debug_http response route={} kind=sse_head chars={} text={}",
        route,
        head.length(),
        head);
  }

  private String truncateJsonForLog(Object value) {
    try {
      String raw = objectMapper.writeValueAsString(value);
      int max = Math.max(512, taasProperties.getGateway().getDebugLogMaxChars());
      if (raw.length() <= max) {
        return raw;
      }
      return raw.substring(0, max) + "…(truncated,len=" + raw.length() + ")";
    } catch (JsonProcessingException e) {
      return "<json_error " + e.getMessage() + ">";
    }
  }

  /** 供日志脱敏：去掉网关内部 trace 字段，避免重复与噪音。 */
  private static Map<String, Object> shallowWithoutInternalTrace(Map<String, Object> body) {
    if (body == null || body.isEmpty()) {
      return body;
    }
    Map<String, Object> copy = new HashMap<>(body);
    copy.remove("_gateway_debug_trace_id");
    return copy;
  }

  private void maybeLogRequest(String route, Map<String, Object> body) {
    if (!taasProperties.getGateway().isDebugLogHttpBodies()) {
      return;
    }
    log.warn(
        "gateway.debug_http request route={} body={}",
        route,
        truncateJsonForLog(shallowWithoutInternalTrace(body)));
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

  /** 写入下游的同时保留响应流前若干字节，再以 UTF-8 解码用于临时排障。 */
  private static final class HeadCopyOutputStream extends OutputStream {
    private final OutputStream downstream;
    private final int maxCopy;
    private final ByteArrayOutputStream head = new ByteArrayOutputStream();

    HeadCopyOutputStream(OutputStream downstream, int maxCopy) {
      this.downstream = downstream;
      this.maxCopy = maxCopy;
    }

    @Override
    public void write(int b) throws IOException {
      downstream.write(b);
      if (head.size() < maxCopy) {
        head.write(b);
      }
    }

    @Override
    public void write(byte[] b, int off, int len) throws IOException {
      downstream.write(b, off, len);
      int room = maxCopy - head.size();
      if (room > 0) {
        head.write(b, off, Math.min(len, room));
      }
    }

    @Override
    public void flush() throws IOException {
      downstream.flush();
    }

    String capturedHeadUtf8() {
      return head.toString(StandardCharsets.UTF_8);
    }
  }
}
