package com.taas.infra.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

public final class MoneyUtils {
  private static final DateTimeFormatter DAY_FORMAT = DateTimeFormatter.ISO_DATE;

  private MoneyUtils() {
  }

  public static String money(BigDecimal value) {
    if (value == null) {
      return "0";
    }
    return value.stripTrailingZeros().toPlainString();
  }

  public static BigDecimal decimal(Object value) {
    if (value == null) {
      return BigDecimal.ZERO;
    }
    if (value instanceof BigDecimal bigDecimal) {
      return bigDecimal;
    }
    return new BigDecimal(String.valueOf(value));
  }

  public static BigDecimal percent(long ok, long total) {
    if (total <= 0) {
      return BigDecimal.valueOf(100);
    }
    return BigDecimal.valueOf(ok * 1000.0 / total).setScale(1, RoundingMode.HALF_UP)
        .stripTrailingZeros();
  }

  public static String dayPeriod() {
    return LocalDate.now(ZoneOffset.UTC).format(DAY_FORMAT);
  }

  public static String dayPeriod(Instant instant) {
    return LocalDate.ofInstant(instant, ZoneOffset.UTC).format(DAY_FORMAT);
  }
}
