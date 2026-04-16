package com.taas.infra.util;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.UUID;

public final class Ids {
  private static final SecureRandom RANDOM = new SecureRandom();

  private Ids() {
  }

  public static String cuidLike(String prefix) {
    return prefix + "_" + UUID.randomUUID().toString().replace("-", "");
  }

  public static String shortHex(int bytes) {
    byte[] raw = new byte[bytes];
    RANDOM.nextBytes(raw);
    return HexFormat.of().formatHex(raw);
  }
}
