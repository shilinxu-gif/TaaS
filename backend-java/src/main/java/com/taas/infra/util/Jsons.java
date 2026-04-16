package com.taas.infra.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class Jsons {
  private final ObjectMapper objectMapper;

  public Jsons(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public String stringify(Object value) {
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException(exception);
    }
  }

  public Map<String, Object> readObject(String raw) {
    if (raw == null || raw.isBlank()) {
      return Collections.emptyMap();
    }
    try {
      return objectMapper.readValue(raw, new TypeReference<>() {});
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException(exception);
    }
  }

  public List<String> readStringList(String raw) {
    if (raw == null || raw.isBlank()) {
      return Collections.emptyList();
    }
    try {
      return objectMapper.readValue(raw, new TypeReference<>() {});
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException(exception);
    }
  }

  public List<Map<String, Object>> readObjectList(String raw) {
    if (raw == null || raw.isBlank()) {
      return Collections.emptyList();
    }
    try {
      return objectMapper.readValue(raw, new TypeReference<>() {});
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException(exception);
    }
  }
}
