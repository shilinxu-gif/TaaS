package com.taas.infra.security;

import com.taas.infra.config.TaasProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
public class CryptoUtils {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final TaasProperties properties;

  public CryptoUtils(TaasProperties properties) {
    this.properties = properties;
  }

  public String hashAppKey(String token) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] raw =
          digest.digest(
              (properties.getSecurity().getAppKeyPepper() + ":" + token)
                  .getBytes(StandardCharsets.UTF_8));
      return java.util.HexFormat.of().formatHex(raw);
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }

  public String generateAppKeyToken() {
    byte[] raw = new byte[24];
    RANDOM.nextBytes(raw);
    return "sk-live-" + java.util.HexFormat.of().formatHex(raw);
  }

  public String buildAppKeyPreview(String token) {
    if (token == null || token.length() < 14) {
      return token;
    }
    return token.substring(0, 10) + "…" + token.substring(token.length() - 4);
  }

  public String encryptSecret(String plain) {
    try {
      byte[] iv = new byte[12];
      RANDOM.nextBytes(iv);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
      byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
      byte[] data = new byte[Math.max(0, encrypted.length - 16)];
      byte[] tag = new byte[16];
      System.arraycopy(encrypted, 0, data, 0, data.length);
      System.arraycopy(encrypted, data.length, tag, 0, tag.length);
      return base64Url(iv) + "." + base64Url(tag) + "." + base64Url(data);
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }

  public String decryptSecret(String ciphertext) {
    if (ciphertext == null || ciphertext.isBlank()) {
      return null;
    }
    try {
      String[] parts = ciphertext.split("\\.");
      if (parts.length != 3) {
        throw new IllegalArgumentException("Invalid secret payload");
      }
      byte[] iv = Base64.getUrlDecoder().decode(parts[0]);
      byte[] tag = Base64.getUrlDecoder().decode(parts[1]);
      byte[] data = Base64.getUrlDecoder().decode(parts[2]);
      byte[] merged = new byte[data.length + tag.length];
      System.arraycopy(data, 0, merged, 0, data.length);
      System.arraycopy(tag, 0, merged, data.length, tag.length);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
      return new String(cipher.doFinal(merged), StandardCharsets.UTF_8);
    } catch (Exception exception) {
      throw new IllegalStateException(exception);
    }
  }

  private SecretKeySpec secretKey() throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    return new SecretKeySpec(
        digest.digest(
            properties.getSecurity().getProviderConfigSecret().getBytes(StandardCharsets.UTF_8)),
        "AES");
  }

  private String base64Url(byte[] bytes) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }
}
