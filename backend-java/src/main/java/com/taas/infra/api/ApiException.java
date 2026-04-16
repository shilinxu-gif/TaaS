package com.taas.infra.api;

public class ApiException extends RuntimeException {
  private final int statusCode;
  private final String code;

  public ApiException(int statusCode, String message) {
    this(statusCode, message, null);
  }

  public ApiException(int statusCode, String message, String code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }

  public int getStatusCode() {
    return statusCode;
  }

  public String getCode() {
    return code;
  }
}
