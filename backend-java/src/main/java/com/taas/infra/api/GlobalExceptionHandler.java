package com.taas.infra.api;

import java.util.Map;
import java.util.LinkedHashMap;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {
  @ExceptionHandler(ApiException.class)
  public ResponseEntity<Map<String, Object>> handleApi(ApiException exception) {
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    body.put("error", exception.getMessage());
    if (exception.getCode() != null && !exception.getCode().isBlank()) {
      body.put("code", exception.getCode());
    }
    return ResponseEntity.status(exception.getStatusCode()).body(body);
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, Object>> handleValidation(
      MethodArgumentNotValidException exception) {
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    body.put("error", "参数无效");
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
                                ? "invalid"
                                : error.getDefaultMessage(),
                        Collectors.toList()))));
    return ResponseEntity.badRequest().body(body);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, Object>> handleAny(Exception exception) {
    LinkedHashMap<String, Object> body = new LinkedHashMap<>();
    body.put(
        "error",
        exception.getMessage() == null
            ? exception.getClass().getSimpleName()
            : exception.getMessage());
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
  }
}
