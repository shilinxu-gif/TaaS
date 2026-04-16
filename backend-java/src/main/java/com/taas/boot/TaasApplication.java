package com.taas.boot;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "com.taas")
@MapperScan("com.taas")
public class TaasApplication {
  public static void main(String[] args) {
    SpringApplication.run(TaasApplication.class, args);
  }
}
