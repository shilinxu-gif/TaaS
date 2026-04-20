package com.taas.infra.api;

import java.util.Map;
import java.util.LinkedHashMap;
import java.util.stream.Collectors;
import com.taas.infra.i18n.ApiMessageResolver;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {
  private final ApiMessageResolver messages;

  public GlobalExceptionHandler(ApiMessageResolver messages) {
    this.messages = messages;
  }

  @ExceptionHandler(ApiException.class)
  public ResponseEntity<Map<String, Object>> handleApi(ApiException exception) {
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    body.put("error", messages.resolve(exception.getMessage(), exception.getCode()));
    if (exception.getCode() != null && !exception.getCode().isBlank()) {
      body.put("code", exception.getCode());
    }
    return ResponseEntity.status(exception.getStatusCode()).body(body);
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, Object>> handleValidation(
      MethodArgumentNotValidException exception) {
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    body.put("error", messages.get("error.invalidArguments"));
    body.put(
        "details",
        exception.getBindingResult().getFieldErrors().stream()
            .collect(
                Collectors.groupingBy(
                    error -> error.getField(),
                    LinkedHashMap::new,
                    Collectors.mapping(
                        error ->
                            error.getDefaultMessage() == null
                                ? messages.get("error.invalidValue")
                                : error.getDefaultMessage(),
                        Collectors.toList()))));
    return ResponseEntity.badRequest().body(body);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> handleAny(Exception exception) {
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    String raw =
        exception.getMessage() == null
            ? exception.getClass().getSimpleName()
            : exception.getMessage();
    body.put("error", messages.resolve(raw, null));
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
  }
}
