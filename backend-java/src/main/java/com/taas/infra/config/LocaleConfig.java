package com.taas.infra.config;

import java.util.List;
import java.util.Locale;
import org.springframework.context.MessageSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.support.ReloadableResourceBundleMessageSource;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.i18n.AcceptHeaderLocaleResolver;

@Configuration
public class LocaleConfig {
  @Bean
  MessageSource messageSource() {
    ReloadableResourceBundleMessageSource source =
        new ReloadableResourceBundleMessageSource();
    source.setBasenames("classpath:messages");
    source.setDefaultEncoding("UTF-8");
    source.setFallbackToSystemLocale(false);
    source.setUseCodeAsDefaultMessage(true);
    return source;
  }

  @Bean
  LocaleResolver localeResolver() {
    AcceptHeaderLocaleResolver resolver = new AcceptHeaderLocaleResolver();
    resolver.setDefaultLocale(Locale.SIMPLIFIED_CHINESE);
    resolver.setSupportedLocales(List.of(Locale.SIMPLIFIED_CHINESE, Locale.US));
    return resolver;
  }

  @Bean
  LocalValidatorFactoryBean validator(MessageSource messageSource) {
    LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
    validator.setValidationMessageSource(messageSource);
    return validator;
  }
}
